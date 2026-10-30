import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { awsCredentials } from "../aws";
import type { MeteredAction } from "../route-gate";

export type Grant = {
  sub: string;
  action: MeteredAction;
  email: string;
  limit: number;
  used: number;
  /** Epoch seconds. */
  expiresAt: number;
  grantedAt: number;
  note?: string;
};

export interface GrantStore {
  get(sub: string, action: MeteredAction): Promise<Grant | null>;
  /** Takes one use. False when there is none left, it expired, or the row is
   * gone; throws for any other failure. */
  consume(sub: string, action: MeteredAction, now: number): Promise<boolean>;
  put(grant: Grant): Promise<void>;
  remove(sub: string, action: MeteredAction): Promise<void>;
  list(sub: string): Promise<Grant[]>;
  removeAll(sub: string): Promise<void>;
}

// DynamoDB's TTL deletes a row this long after the grant expires, which keeps
// a month of history for the Access page.
export const GRANT_TTL_S = 30 * 24 * 60 * 60;

let doc: DynamoDBDocumentClient | null = null;

function client(): DynamoDBDocumentClient {
  return (doc ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }),
    { marshallOptions: { removeUndefinedValues: true } },
  ));
}

function dynamoStore(table: string): GrantStore {
  const key = (sub: string, action: MeteredAction) => ({ sub, action });
  const store: GrantStore = {
    async get(sub, action) {
      const out = await client().send(new GetCommand({ TableName: table, Key: key(sub, action) }));
      return (out.Item as Grant | undefined) ?? null;
    },
    async consume(sub, action, now) {
      try {
        await client().send(
          new UpdateCommand({
            TableName: table,
            Key: key(sub, action),
            UpdateExpression: "SET #used = #used + :one",
            ConditionExpression: "attribute_exists(#sub) AND #used < #limit AND #expiresAt > :now",
            // limit is a DynamoDB reserved word, so every name goes through a placeholder.
            ExpressionAttributeNames: { "#sub": "sub", "#used": "used", "#limit": "limit", "#expiresAt": "expiresAt" },
            ExpressionAttributeValues: { ":one": 1, ":now": now },
          }),
        );
        return true;
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) return false;
        throw err;
      }
    },
    async put(grant) {
      await client().send(new PutCommand({ TableName: table, Item: { ...grant, ttl: grant.expiresAt + GRANT_TTL_S } }));
    },
    async remove(sub, action) {
      await client().send(new DeleteCommand({ TableName: table, Key: key(sub, action) }));
    },
    async list(sub) {
      const out = await client().send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "#sub = :sub",
          ExpressionAttributeNames: { "#sub": "sub" },
          ExpressionAttributeValues: { ":sub": sub },
        }),
      );
      return (out.Items as Grant[] | undefined) ?? [];
    },
    async removeAll(sub) {
      for (const grant of await store.list(sub)) await store.remove(sub, grant.action);
    },
  };
  return store;
}

function notConfigured(): never {
  throw new Error("grants: ACCESS_GRANTS_TABLE is not set");
}

const unconfigured: GrantStore = {
  get: async () => notConfigured(),
  consume: async () => notConfigured(),
  put: async () => notConfigured(),
  remove: async () => notConfigured(),
  list: async () => notConfigured(),
  removeAll: async () => notConfigured(),
};

// e2e has no AWS. Same guard as the local authorizer: never on a deployment.
const memory = new Map<string, Grant>();
const memoryStore: GrantStore = {
  async get(sub, action) {
    return memory.get(`${sub}|${action}`) ?? null;
  },
  async consume(sub, action, now) {
    const grant = memory.get(`${sub}|${action}`);
    if (!grant || grant.used >= grant.limit || grant.expiresAt <= now) return false;
    grant.used += 1;
    return true;
  },
  async put(grant) {
    memory.set(`${grant.sub}|${grant.action}`, { ...grant });
  },
  async remove(sub, action) {
    memory.delete(`${sub}|${action}`);
  },
  async list(sub) {
    return [...memory.values()].filter((g) => g.sub === sub);
  },
  async removeAll(sub) {
    for (const key of [...memory.keys()]) if (key.startsWith(`${sub}|`)) memory.delete(key);
  },
};

export function getGrantStore(env: NodeJS.ProcessEnv = process.env): GrantStore {
  if (env.AUTHZ_MODE === "local" && !env.VERCEL) return memoryStore;
  const table = env.ACCESS_GRANTS_TABLE;
  return table ? dynamoStore(table) : unconfigured;
}

import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { awsCredentials } from "../aws";
import { DEFAULT_DESIRED, VpnError, type Desired, type ServerReport } from "./model";

export interface VpnStore {
  read(): Promise<{ desired: Desired; server: ServerReport | null }>;
  /** False when the stored version is not `expectedVersion`; throws for any other failure. */
  writeDesired(next: Desired, expectedVersion: number): Promise<boolean>;
}

let doc: DynamoDBDocumentClient | null = null;

function client(): DynamoDBDocumentClient {
  return (doc ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }),
    { marshallOptions: { removeUndefinedValues: true } },
  ));
}

// The web role may only get and put `desired`. `server` belongs to the VM's agent.
function dynamoStore(table: string): VpnStore {
  const get = async (pk: "desired" | "server") =>
    (await client().send(new GetCommand({ TableName: table, Key: { pk }, ConsistentRead: true }))).Item;
  return {
    async read() {
      const [desired, server] = await Promise.all([get("desired"), get("server")]);
      return {
        desired: (desired as Desired | undefined) ?? structuredClone(DEFAULT_DESIRED),
        server: (server as ServerReport | undefined) ?? null,
      };
    },
    async writeDesired(next, expectedVersion) {
      const condition =
        expectedVersion === 0
          ? { ConditionExpression: "attribute_not_exists(pk)" }
          : {
              ConditionExpression: "#v = :v",
              ExpressionAttributeNames: { "#v": "version" },
              ExpressionAttributeValues: { ":v": expectedVersion },
            };
      try {
        await client().send(new PutCommand({ TableName: table, Item: next, ...condition }));
        return true;
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) return false;
        throw err;
      }
    },
  };
}

// e2e has no AWS. Same guard as the local authorizer: never on a deployment.
let memoryDesired: Desired = structuredClone(DEFAULT_DESIRED);

export function resetMemoryVpnStore(): void {
  memoryDesired = structuredClone(DEFAULT_DESIRED);
}

const memoryStore: VpnStore = {
  async read() {
    const now = Math.floor(Date.now() / 1000);
    return {
      desired: structuredClone(memoryDesired),
      server: {
        pk: "server",
        publicKey: "TESTSERVERKEYTESTSERVERKEYTESTSERVERKEY0000=",
        endpoint: "203.0.113.10:51820",
        appliedVersion: memoryDesired.version,
        lastSeen: now,
        certNotAfter: now + 365 * 86400,
        error: null,
        peers: {},
      },
    };
  },
  async writeDesired(next, expectedVersion) {
    if (memoryDesired.version !== expectedVersion) return false;
    memoryDesired = structuredClone(next);
    return true;
  },
};

export function getVpnStore(env: NodeJS.ProcessEnv = process.env): VpnStore | null {
  if (env.AUTHZ_MODE === "local" && !env.VERCEL) return memoryStore;
  const table = env.VPN_TABLE_NAME;
  return table ? dynamoStore(table) : null;
}

/** Reads, applies `change`, and writes under the version it read. One retry on a
 * lost race; a second loss throws `conflict`. Errors from `change` pass through. */
export async function mutateDesired(
  store: VpnStore,
  change: (d: Desired) => Desired,
): Promise<Desired> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { desired } = await store.read();
    const next = change(desired);
    if (await store.writeDesired(next, desired.version)) return next;
  }
  throw new VpnError("conflict");
}

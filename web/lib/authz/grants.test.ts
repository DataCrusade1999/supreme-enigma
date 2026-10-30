// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getGrantStore, GRANT_TTL_S, type Grant } from "./grants";

const ddb = mockClient(DynamoDBDocumentClient);
const env = { ACCESS_GRANTS_TABLE: "grants", APP_AWS_REGION: "us-east-1" } as unknown as NodeJS.ProcessEnv;
const grant: Grant = { sub: "u1", action: "newsdesk:ask", email: "a@example.com", limit: 20, used: 3, expiresAt: 2000, grantedAt: 1000 };

beforeEach(() => ddb.reset());

describe("DynamoDB grant store", () => {
  it("gets a row by sub and action", async () => {
    ddb.on(GetCommand).resolves({ Item: grant });
    expect(await getGrantStore(env).get("u1", "newsdesk:ask")).toEqual(grant);
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toEqual({ TableName: "grants", Key: { sub: "u1", action: "newsdesk:ask" } });
  });

  it("returns null for a missing row", async () => {
    ddb.on(GetCommand).resolves({});
    expect(await getGrantStore(env).get("u1", "newsdesk:ask")).toBeNull();
  });

  it("consumes one use only while used < limit and not expired", async () => {
    ddb.on(UpdateCommand).resolves({});
    expect(await getGrantStore(env).consume("u1", "newsdesk:ask", 1500)).toBe(true);
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input).toEqual({
      TableName: "grants",
      Key: { sub: "u1", action: "newsdesk:ask" },
      UpdateExpression: "SET #used = #used + :one",
      ConditionExpression: "attribute_exists(#sub) AND #used < #limit AND #expiresAt > :now",
      ExpressionAttributeNames: { "#sub": "sub", "#used": "used", "#limit": "limit", "#expiresAt": "expiresAt" },
      ExpressionAttributeValues: { ":one": 1, ":now": 1500 },
    });
  });

  it("returns false when the condition fails: the last use went to another request", async () => {
    ddb.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ message: "failed", $metadata: {} }));
    expect(await getGrantStore(env).consume("u1", "newsdesk:ask", 1500)).toBe(false);
  });

  it("rethrows any other DynamoDB error, so the proxy fails closed", async () => {
    ddb.on(UpdateCommand).rejects(new Error("ProvisionedThroughputExceededException"));
    await expect(getGrantStore(env).consume("u1", "newsdesk:ask", 1500)).rejects.toThrow("Provisioned");
  });

  it("puts a row with used and ttl set from the grant", async () => {
    ddb.on(PutCommand).resolves({});
    await getGrantStore(env).put({ ...grant, used: 0, note: "emailed" });
    expect(ddb.commandCalls(PutCommand)[0].args[0].input).toEqual({
      TableName: "grants",
      Item: { ...grant, used: 0, note: "emailed", ttl: 2000 + GRANT_TTL_S },
    });
  });

  it("lists a user's rows and removes them all", async () => {
    ddb.on(QueryCommand).resolves({ Items: [grant, { ...grant, action: "looper:process" }] });
    ddb.on(DeleteCommand).resolves({});
    const store = getGrantStore(env);
    expect((await store.list("u1")).map((g) => g.action)).toEqual(["newsdesk:ask", "looper:process"]);
    await store.removeAll("u1");
    expect(ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key)).toEqual([
      { sub: "u1", action: "newsdesk:ask" },
      { sub: "u1", action: "looper:process" },
    ]);
  });

  it("throws when the table name is missing", async () => {
    await expect(getGrantStore({} as unknown as NodeJS.ProcessEnv).get("u1", "newsdesk:ask")).rejects.toThrow("ACCESS_GRANTS_TABLE");
  });
});

describe("in-memory grant store (AUTHZ_MODE=local)", () => {
  const local = { AUTHZ_MODE: "local" } as unknown as NodeJS.ProcessEnv;

  it("behaves like the table", async () => {
    const store = getGrantStore(local);
    await store.put({ ...grant, sub: "mem", limit: 1, used: 0 });
    expect(await store.consume("mem", "newsdesk:ask", 1500)).toBe(true);
    expect(await store.consume("mem", "newsdesk:ask", 1500)).toBe(false);
    expect(await store.consume("mem", "newsdesk:ask", 2500)).toBe(false);
    await store.removeAll("mem");
    expect(await store.list("mem")).toEqual([]);
  });

  it("is never used on Vercel", async () => {
    await expect(getGrantStore({ AUTHZ_MODE: "local", VERCEL: "1" } as unknown as NodeJS.ProcessEnv).get("u1", "newsdesk:ask")).rejects.toThrow(
      "ACCESS_GRANTS_TABLE",
    );
  });
});

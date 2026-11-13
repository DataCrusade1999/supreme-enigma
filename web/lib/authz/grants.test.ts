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
import { getGrantStore, GRANT_TTL_S, isLive, isUnexpired, type Grant } from "./grants";

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
      { sub: "u1", action: "_welcomed" },
    ]);
  });

  it("reads a user's rows consistently", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await getGrantStore(env).list("u1");
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input.ConsistentRead).toBe(true);
  });

  it("puts a time-only row without limit or used", async () => {
    ddb.on(PutCommand).resolves({});
    await getGrantStore(env).put({ sub: "u1", action: "newsdesk:read", email: "a@example.com", expiresAt: 2000, grantedAt: 1000 });
    const item = ddb.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item).toEqual({ sub: "u1", action: "newsdesk:read", email: "a@example.com", expiresAt: 2000, grantedAt: 1000, ttl: 2000 + GRANT_TTL_S });
    expect("limit" in item).toBe(false);
    expect("used" in item).toBe(false);
  });

  it("never lists the welcome marker", async () => {
    ddb.on(QueryCommand).resolves({ Items: [grant, { sub: "u1", action: "_welcomed", at: 5 }] });
    expect((await getGrantStore(env).list("u1")).map((g) => g.action)).toEqual(["newsdesk:ask"]);
  });

  it("records the welcome marker with no ttl and reads it consistently", async () => {
    ddb.on(GetCommand).resolves({});
    ddb.on(PutCommand).resolves({});
    const store = getGrantStore(env);
    expect(await store.wasWelcomed("u1")).toBe(false);
    expect(ddb.commandCalls(GetCommand)[0].args[0].input).toEqual({
      TableName: "grants",
      Key: { sub: "u1", action: "_welcomed" },
      ConsistentRead: true,
    });
    await store.markWelcomed("u1", 77);
    expect(ddb.commandCalls(PutCommand)[0].args[0].input).toEqual({
      TableName: "grants",
      Item: { sub: "u1", action: "_welcomed", at: 77 },
    });
    ddb.on(GetCommand).resolves({ Item: { sub: "u1", action: "_welcomed", at: 77 } });
    expect(await store.wasWelcomed("u1")).toBe(true);
  });

  it("removeAll deletes the grants and the marker", async () => {
    ddb.on(QueryCommand).resolves({ Items: [grant, { sub: "u1", action: "_welcomed", at: 5 }] });
    ddb.on(DeleteCommand).resolves({});
    await getGrantStore(env).removeAll("u1");
    expect(ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key)).toEqual([
      { sub: "u1", action: "newsdesk:ask" },
      { sub: "u1", action: "_welcomed" },
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

  it("keeps the welcome marker out of list and clears it with removeAll", async () => {
    const store = getGrantStore(local);
    expect(await store.wasWelcomed("w")).toBe(false);
    await store.put({ ...grant, sub: "w" });
    await store.markWelcomed("w", 5);
    expect(await store.wasWelcomed("w")).toBe(true);
    expect((await store.list("w")).map((g) => g.action)).toEqual(["newsdesk:ask"]);
    await store.removeAll("w");
    expect(await store.wasWelcomed("w")).toBe(false);
    expect(await store.list("w")).toEqual([]);
  });

  it("is never used on Vercel", async () => {
    await expect(getGrantStore({ AUTHZ_MODE: "local", VERCEL: "1" } as unknown as NodeJS.ProcessEnv).get("u1", "newsdesk:ask")).rejects.toThrow(
      "ACCESS_GRANTS_TABLE",
    );
  });
});

describe("isLive and isUnexpired", () => {
  it("is false for a metered grant that is used up", () => {
    expect(isLive({ ...grant, used: 20 }, 1500)).toBe(false);
  });

  it("is true for a metered grant with uses left", () => {
    expect(isLive(grant, 1500)).toBe(true);
  });

  it("is true for an unexpired time-only grant", () => {
    const g: Grant = { sub: "u1", action: "newsdesk:read", email: "", expiresAt: 2000, grantedAt: 1000 };
    expect(isLive(g, 1999)).toBe(true);
    expect(isUnexpired(g, 1999)).toBe(true);
  });

  it("is false once expired, at the expiry second included", () => {
    const g: Grant = { sub: "u1", action: "newsdesk:read", email: "", expiresAt: 2000, grantedAt: 1000 };
    expect(isLive(g, 2000)).toBe(false);
    expect(isUnexpired(g, 2000)).toBe(false);
    expect(isLive(grant, 2001)).toBe(false);
  });
});

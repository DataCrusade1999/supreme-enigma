// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DEFAULT_DESIRED, VpnError, type Desired } from "./model";
import { getVpnStore, mutateDesired, resetMemoryVpnStore, type VpnStore } from "./store";

const ddb = mockClient(DynamoDBDocumentClient);
const env = { VPN_TABLE_NAME: "bgm-looper-vpn", APP_AWS_REGION: "us-east-1" } as unknown as NodeJS.ProcessEnv;
const memEnv = { AUTHZ_MODE: "local" } as unknown as NodeJS.ProcessEnv;

const conditionFailed = () =>
  new ConditionalCheckFailedException({ message: "conditional check failed", $metadata: {} });

const desired = (version: number): Desired => ({ ...structuredClone(DEFAULT_DESIRED), version });

beforeEach(() => {
  ddb.reset();
  resetMemoryVpnStore();
});

describe("DynamoDB VPN store", () => {
  it("reads both items with consistent reads", async () => {
    ddb.on(GetCommand).resolves({});
    await getVpnStore(env)!.read();
    const inputs = ddb.commandCalls(GetCommand).map((c) => c.args[0].input);
    expect(inputs).toContainEqual({ TableName: "bgm-looper-vpn", Key: { pk: "desired" }, ConsistentRead: true });
    expect(inputs).toContainEqual({ TableName: "bgm-looper-vpn", Key: { pk: "server" }, ConsistentRead: true });
    expect(inputs).toHaveLength(2);
  });

  it("returns DEFAULT_DESIRED and null server when neither item exists", async () => {
    ddb.on(GetCommand).resolves({});
    const out = await getVpnStore(env)!.read();
    expect(out.desired).toEqual(DEFAULT_DESIRED);
    expect(out.desired).not.toBe(DEFAULT_DESIRED);
    expect(out.server).toBeNull();
  });

  it("writes desired with a version condition", async () => {
    ddb.on(PutCommand).resolves({});
    const next = desired(4);
    expect(await getVpnStore(env)!.writeDesired(next, 3)).toBe(true);
    expect(ddb.commandCalls(PutCommand)[0].args[0].input).toEqual({
      TableName: "bgm-looper-vpn",
      Item: next,
      ConditionExpression: "#v = :v",
      ExpressionAttributeNames: { "#v": "version" },
      ExpressionAttributeValues: { ":v": 3 },
    });
  });

  it("first write uses attribute_not_exists", async () => {
    ddb.on(PutCommand).resolves({});
    await getVpnStore(env)!.writeDesired(desired(1), 0);
    const input = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(input.ConditionExpression).toBe("attribute_not_exists(pk)");
    expect(input.ExpressionAttributeNames).toBeUndefined();
    expect(input.ExpressionAttributeValues).toBeUndefined();
  });

  it("writeDesired resolves false on ConditionalCheckFailedException", async () => {
    ddb.on(PutCommand).rejects(conditionFailed());
    expect(await getVpnStore(env)!.writeDesired(desired(4), 3)).toBe(false);
  });

  it("writeDesired throws on other failures", async () => {
    ddb.on(PutCommand).rejects(new Error("boom"));
    await expect(getVpnStore(env)!.writeDesired(desired(4), 3)).rejects.toThrow("boom");
  });

  it("never writes the server item", async () => {
    ddb.on(PutCommand).resolves({});
    await getVpnStore(env)!.writeDesired(desired(1), 0);
    for (const c of ddb.commandCalls(PutCommand)) {
      expect((c.args[0].input.Item as { pk: string }).pk).toBe("desired");
    }
  });
});

describe("mutateDesired", () => {
  it("retries once on a version conflict, then reports conflict", async () => {
    ddb.on(GetCommand).resolves({ Item: desired(2) });
    ddb.on(PutCommand).rejectsOnce(conditionFailed()).resolvesOnce({});
    const out = await mutateDesired(getVpnStore(env)!, (d) => ({ ...d, version: d.version + 1 }));
    expect(out.version).toBe(3);
    const desiredGets = ddb
      .commandCalls(GetCommand)
      .filter((c) => (c.args[0].input.Key as { pk: string }).pk === "desired");
    expect(desiredGets).toHaveLength(2);

    ddb.reset();
    ddb.on(GetCommand).resolves({ Item: desired(2) });
    ddb.on(PutCommand).rejects(conditionFailed());
    const err = await mutateDesired(getVpnStore(env)!, (d) => d).catch((e) => e);
    expect(err).toBeInstanceOf(VpnError);
    expect(err.code).toBe("conflict");
  });

  it("propagates VpnErrors from change without retrying", async () => {
    ddb.on(GetCommand).resolves({ Item: desired(2) });
    const err = await mutateDesired(getVpnStore(env)!, () => {
      throw new VpnError("full");
    }).catch((e) => e);
    expect(err).toBeInstanceOf(VpnError);
    expect(err.code).toBe("full");
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddb.commandCalls(GetCommand).length).toBe(2);
  });
});

describe("getVpnStore", () => {
  it("picks memory only off Vercel", () => {
    const dynamo = getVpnStore({ ...memEnv, VERCEL: "1", VPN_TABLE_NAME: "t", APP_AWS_REGION: "us-east-1" } as unknown as NodeJS.ProcessEnv);
    expect(dynamo).not.toBeNull();
    expect(dynamo).not.toBe(getVpnStore(memEnv));
    expect(getVpnStore({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("memory VPN store", () => {
  let store: VpnStore;
  beforeEach(() => {
    store = getVpnStore(memEnv)!;
  });

  it("starts from a clone of DEFAULT_DESIRED with a fake server that is applied", async () => {
    const out = await store.read();
    expect(out.desired).toEqual(DEFAULT_DESIRED);
    expect(out.desired).not.toBe(DEFAULT_DESIRED);
    const now = Math.floor(Date.now() / 1000);
    expect(out.server).toMatchObject({
      pk: "server",
      publicKey: "TESTSERVERKEYTESTSERVERKEYTESTSERVERKEY0000=",
      endpoint: "203.0.113.10:51820",
      appliedVersion: 0,
      error: null,
      peers: {},
    });
    expect(Math.abs(out.server!.lastSeen - now)).toBeLessThan(5);
    expect(Math.abs(out.server!.certNotAfter - (now + 365 * 86400))).toBeLessThan(5);
  });

  it("honors the version condition", async () => {
    expect(await store.writeDesired(desired(1), 0)).toBe(true);
    expect(await store.writeDesired(desired(2), 0)).toBe(false);
    expect(await store.writeDesired(desired(2), 1)).toBe(true);
    expect((await store.read()).desired.version).toBe(2);
  });

  it("reports the current version as applied", async () => {
    await store.writeDesired(desired(1), 0);
    expect((await store.read()).server!.appliedVersion).toBe(1);
  });

  it("clones on read and on write", async () => {
    const next = desired(1);
    await store.writeDesired(next, 0);
    next.settings.dns.push("9.9.9.9");
    const first = (await store.read()).desired;
    expect(first.settings.dns).toEqual(["1.1.1.1", "1.0.0.1"]);
    first.settings.dns.push("8.8.8.8");
    expect((await store.read()).desired.settings.dns).toEqual(["1.1.1.1", "1.0.0.1"]);
  });

  it("never mutates DEFAULT_DESIRED and resets to a clean state", async () => {
    const d = (await store.read()).desired;
    d.settings.dns.push("8.8.8.8");
    expect(DEFAULT_DESIRED.settings.dns).toEqual(["1.1.1.1", "1.0.0.1"]);
    await store.writeDesired(desired(5), 0);
    resetMemoryVpnStore();
    expect((await store.read()).desired.version).toBe(0);
  });
});

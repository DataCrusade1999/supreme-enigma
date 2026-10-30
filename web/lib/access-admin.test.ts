// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

vi.mock("./authz/grants", () => ({ getGrantStore: vi.fn() }));
import { getGrantStore } from "./authz/grants";
import { AccessError, approve, dismiss, grantAction, listUsers, removeMember, revokeGrant } from "./access-admin";

const cognito = mockClient(CognitoIdentityProviderClient);
const store = { list: vi.fn(), put: vi.fn(), remove: vi.fn(), removeAll: vi.fn() };

const cognitoUser = (sub: string, username = `Google_${sub}`) => ({
  Username: username,
  UserCreateDate: new Date("2026-10-01T00:00:00Z"),
  Attributes: [
    { Name: "sub", Value: sub },
    { Name: "email", Value: `${sub}@example.com` },
  ],
});

function groupsOf(map: Record<string, string[]>) {
  cognito.on(AdminListGroupsForUserCommand).callsFake((input) => ({
    Groups: (map[input.Username] ?? []).map((GroupName) => ({ GroupName })),
  }));
}

beforeEach(() => {
  cognito.reset();
  vi.clearAllMocks();
  process.env.COGNITO_USER_POOL_ID = "us-east-1_pool";
  process.env.APP_AWS_REGION = "us-east-1";
  vi.mocked(getGrantStore).mockReturnValue(store as never);
  store.list.mockResolvedValue([]);
});

describe("listUsers", () => {
  it("returns every user with a status and, for members, their grants", async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [cognitoUser("o", "owner-uuid"), cognitoUser("f"), cognitoUser("p")] });
    groupsOf({ "owner-uuid": ["owner"], Google_f: ["friends", "us-east-1_pool_Google"], Google_p: ["us-east-1_pool_Google"] });
    store.list.mockImplementation(async (sub: string) => (sub === "f" ? [{ action: "newsdesk:ask" }] : []));

    const users = await listUsers();
    expect(users.map((u) => [u.sub, u.status, u.grants.length])).toEqual([
      ["o", "owner", 0],
      ["f", "member", 1],
      ["p", "pending", 0],
    ]);
    expect(users[1]).toMatchObject({ username: "Google_f", email: "f@example.com", createdAt: "2026-10-01T00:00:00.000Z" });
  });

  it("follows pagination", async () => {
    cognito
      .on(ListUsersCommand)
      .resolvesOnce({ Users: [cognitoUser("a")], PaginationToken: "next" })
      .resolvesOnce({ Users: [cognitoUser("b")] });
    groupsOf({});
    expect((await listUsers()).map((u) => u.sub)).toEqual(["a", "b"]);
  });
});

describe("changes", () => {
  function only(sub: string, groups: string[]) {
    cognito.on(ListUsersCommand, { Filter: `sub = "${sub}"` }).resolves({ Users: [cognitoUser(sub)] });
    groupsOf({ [`Google_${sub}`]: groups });
  }

  it("approve adds a pending user to friends", async () => {
    only("p", []);
    cognito.on(AdminAddUserToGroupCommand).resolves({});
    expect((await approve("p")).email).toBe("p@example.com");
    expect(cognito.commandCalls(AdminAddUserToGroupCommand)[0].args[0].input).toEqual({
      UserPoolId: "us-east-1_pool",
      Username: "Google_p",
      GroupName: "friends",
    });
  });

  it("removeMember removes the group, signs out everywhere and deletes grants", async () => {
    only("f", ["friends"]);
    cognito.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognito.on(AdminUserGlobalSignOutCommand).resolves({});
    await removeMember("f");
    expect(cognito.commandCalls(AdminRemoveUserFromGroupCommand)).toHaveLength(1);
    expect(cognito.commandCalls(AdminUserGlobalSignOutCommand)).toHaveLength(1);
    expect(store.removeAll).toHaveBeenCalledWith("f");
  });

  it("dismiss deletes a pending user", async () => {
    only("p", ["us-east-1_pool_Google"]);
    cognito.on(AdminDeleteUserCommand).resolves({});
    await dismiss("p");
    expect(cognito.commandCalls(AdminDeleteUserCommand)).toHaveLength(1);
  });

  it("grantAction writes a fresh row for a member", async () => {
    only("f", ["friends"]);
    const { grant } = await grantAction({ sub: "f", action: "newsdesk:ask", limit: 20, expiresInDays: 7, note: "emailed", now: 1000 });
    expect(grant).toEqual({
      sub: "f",
      action: "newsdesk:ask",
      email: "f@example.com",
      limit: 20,
      used: 0,
      expiresAt: 1000 + 7 * 86400,
      grantedAt: 1000,
      note: "emailed",
    });
    expect(store.put).toHaveBeenCalledWith(grant);
  });

  it("revokeGrant deletes one row", async () => {
    only("f", ["friends"]);
    await revokeGrant("f", "newsdesk:ask");
    expect(store.remove).toHaveBeenCalledWith("f", "newsdesk:ask");
  });

  // The owner can't be locked out from this page.
  it.each([
    ["approve", () => approve("o")],
    ["removeMember", () => removeMember("o")],
    ["dismiss", () => dismiss("o")],
    ["grantAction", () => grantAction({ sub: "o", action: "newsdesk:ask", limit: 1, expiresInDays: 1, now: 0 })],
    ["revokeGrant", () => revokeGrant("o", "newsdesk:ask")],
  ])("%s refuses the owner with 409 and changes nothing", async (_label, run) => {
    only("o", ["owner"]);
    await expect(run()).rejects.toMatchObject({ status: 409 });
    expect(cognito.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminRemoveUserFromGroupCommand)).toHaveLength(0);
    expect(cognito.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(store.put).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it.each([
    ["dismiss a member", () => dismiss("f"), ["friends"]],
    ["approve a member again", () => approve("f"), ["friends"]],
    ["grant to a pending user", () => grantAction({ sub: "f", action: "newsdesk:ask", limit: 1, expiresInDays: 1, now: 0 }), []],
    ["remove a pending user", () => removeMember("f"), []],
  ])("refuses to %s with 409", async (_label, run, groups) => {
    only("f", groups as string[]);
    await expect(run()).rejects.toMatchObject({ status: 409 });
  });

  it("answers 404 for an unknown sub", async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [] });
    await expect(approve("nobody")).rejects.toBeInstanceOf(AccessError);
    await expect(approve("nobody")).rejects.toMatchObject({ status: 404 });
  });
});

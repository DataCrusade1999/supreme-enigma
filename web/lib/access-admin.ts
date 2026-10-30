import {
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { awsCredentials } from "./aws";
import { getGrantStore, type Grant } from "./authz/grants";
import type { MeteredAction } from "./route-gate";

export type AccessUser = { sub: string; username: string; email: string; createdAt: string; groups: string[] };
export type AccessStatus = "owner" | "member" | "pending";

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

let client: CognitoIdentityProviderClient | null = null;
function cognito(): CognitoIdentityProviderClient {
  return (client ??= new CognitoIdentityProviderClient({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }));
}
const pool = () => process.env.COGNITO_USER_POOL_ID!;

export function statusOf(user: AccessUser): AccessStatus {
  if (user.groups.includes("owner")) return "owner";
  if (user.groups.includes("friends")) return "member";
  return "pending";
}

async function withGroups(user: UserType): Promise<AccessUser> {
  const attr = (name: string) => user.Attributes?.find((a) => a.Name === name)?.Value ?? "";
  const out = await cognito().send(new AdminListGroupsForUserCommand({ UserPoolId: pool(), Username: user.Username! }));
  return {
    sub: attr("sub"),
    username: user.Username!,
    email: attr("email"),
    createdAt: user.UserCreateDate?.toISOString() ?? "",
    groups: (out.Groups ?? []).map((g) => g.GroupName!).filter(Boolean),
  };
}

export async function listUsers(): Promise<(AccessUser & { status: AccessStatus; grants: Grant[] })[]> {
  const users: UserType[] = [];
  let token: string | undefined;
  do {
    const page = await cognito().send(new ListUsersCommand({ UserPoolId: pool(), PaginationToken: token }));
    users.push(...(page.Users ?? []));
    token = page.PaginationToken;
  } while (token);

  return Promise.all(
    users.map(async (raw) => {
      const user = await withGroups(raw);
      const status = statusOf(user);
      return { ...user, status, grants: status === "member" ? await getGrantStore().list(user.sub) : [] };
    }),
  );
}

// The routes are keyed by sub, as the grants table is; the admin API wants the
// username, which for a Google user is "Google_<id>".
async function findBySub(sub: string): Promise<AccessUser> {
  const out = await cognito().send(new ListUsersCommand({ UserPoolId: pool(), Filter: `sub = "${sub.replace(/"/g, "")}"`, Limit: 1 }));
  const raw = out.Users?.[0];
  if (!raw) throw new AccessError("no such user", 404);
  return withGroups(raw);
}

async function requireStatus(sub: string, expected: AccessStatus): Promise<AccessUser> {
  const user = await findBySub(sub);
  const status = statusOf(user);
  if (status === "owner") throw new AccessError("the owner can't be changed here", 409);
  if (status !== expected) throw new AccessError(`expected a ${expected} user, found a ${status} one`, 409);
  return user;
}

export async function approve(sub: string): Promise<AccessUser> {
  const user = await requireStatus(sub, "pending");
  await cognito().send(new AdminAddUserToGroupCommand({ UserPoolId: pool(), Username: user.username, GroupName: "friends" }));
  return user;
}

export async function removeMember(sub: string): Promise<AccessUser> {
  const user = await requireStatus(sub, "member");
  await cognito().send(new AdminRemoveUserFromGroupCommand({ UserPoolId: pool(), Username: user.username, GroupName: "friends" }));
  // Revokes their refresh tokens: access ends when the current ID token expires.
  await cognito().send(new AdminUserGlobalSignOutCommand({ UserPoolId: pool(), Username: user.username }));
  await getGrantStore().removeAll(user.sub);
  return user;
}

export async function dismiss(sub: string): Promise<AccessUser> {
  const user = await requireStatus(sub, "pending");
  await cognito().send(new AdminDeleteUserCommand({ UserPoolId: pool(), Username: user.username }));
  return user;
}

export async function grantAction(p: {
  sub: string;
  action: MeteredAction;
  limit: number;
  expiresInDays: number;
  note?: string;
  now: number;
}): Promise<{ user: AccessUser; grant: Grant }> {
  const user = await requireStatus(p.sub, "member");
  const grant: Grant = {
    sub: user.sub,
    action: p.action,
    email: user.email,
    limit: p.limit,
    used: 0,
    expiresAt: p.now + p.expiresInDays * 86400,
    grantedAt: p.now,
    ...(p.note ? { note: p.note } : {}),
  };
  await getGrantStore().put(grant);
  return { user, grant };
}

export async function revokeGrant(sub: string, action: MeteredAction): Promise<AccessUser> {
  const user = await requireStatus(sub, "member");
  await getGrantStore().remove(user.sub, action);
  return user;
}

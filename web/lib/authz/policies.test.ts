// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { loadCedar } from "./cedar-files";

const POOL = "us-east-1_test";
const files = loadCedar(POOL);

type Grant = { remaining: number; expiresAt: number };
const NOW = 1_800_000_000;

function decide(groups: string[], action: string, tool: string, grant?: Grant) {
  const principal = { type: "Site::User", id: `${POOL}|user-1` };
  const parents = groups.map((g) => ({ type: "Site::Group", id: `${POOL}|${g}` }));
  const answer = cedar.isAuthorized({
    principal,
    action: { type: "Site::Action", id: action },
    resource: { type: "Site::Tool", id: tool },
    context: grant ? { now: NOW, grant } : { now: NOW },
    schema: files.schema as cedar.Schema,
    validateRequest: true,
    policies: { staticPolicies: files.policies },
    entities: [
      { uid: principal, attrs: {}, parents },
      ...parents.map((uid) => ({ uid, attrs: {}, parents: [] })),
    ],
  });
  if (answer.type !== "success") throw new Error(JSON.stringify(answer.errors));
  return answer.response.decision;
}

const ACTIVE: Grant = { remaining: 3, expiresAt: NOW + 3600 };
const USED_UP: Grant = { remaining: 0, expiresAt: NOW + 3600 };
const EXPIRED: Grant = { remaining: 3, expiresAt: NOW };

const OWNER_ONLY: [string, string][] = [
  ["resume:draft", "resume-admin"],
  ["resume:extract", "resume-admin"],
  ["resume:publish", "resume-admin"],
  ["newsletter:send", "newsletter-admin"],
  ["keystatic:use", "keystatic"],
  ["access:manage", "access-admin"],
];
const METERED: [string, string][] = [
  ["looper:process", "bgm-looper"],
  ["newsdesk:refresh", "news-desk"],
  ["newsdesk:ask", "news-desk"],
];

describe("Cedar schema and policies", () => {
  it("validate in strict mode", () => {
    const answer = cedar.validate({
      schema: files.schema as cedar.Schema,
      policies: { staticPolicies: files.policies },
      validationSettings: { mode: "strict" },
    });
    expect(answer).toMatchObject({ type: "success", validationErrors: [] });
  });

  it("are exactly the four the spec names", () => {
    expect(Object.keys(files.policies)).toEqual([
      "friends-free",
      "friends-metered",
      "owner-all",
      "owner-only-guard",
    ]);
  });
});

describe("owner", () => {
  it.each([...OWNER_ONLY, ...METERED, ["view", "resume-admin"], ["view", "hub"]])(
    "may %s on %s with no grant",
    (action, tool) => {
      expect(decide(["owner"], action, tool)).toBe("allow");
    },
  );
});

describe("friends", () => {
  it.each(["hub", "bgm-looper", "money-planner", "news-desk"])("may view %s", (tool) => {
    expect(decide(["friends"], "view", tool)).toBe("allow");
  });

  it("may pin News Desk indicators", () => {
    expect(decide(["friends"], "newsdesk:pin", "news-desk")).toBe("allow");
  });

  it.each(["resume-admin", "newsletter-admin", "keystatic", "access-admin"])("may not view %s", (tool) => {
    expect(decide(["friends"], "view", tool)).toBe("deny");
  });

  it.each(METERED)("%s on %s needs a grant", (action, tool) => {
    expect(decide(["friends"], action, tool)).toBe("deny");
    expect(decide(["friends"], action, tool, ACTIVE)).toBe("allow");
    expect(decide(["friends"], action, tool, USED_UP)).toBe("deny");
    expect(decide(["friends"], action, tool, EXPIRED)).toBe("deny");
  });

  // The forbid policy: a live grant must never open an owner-only action.
  it.each(OWNER_ONLY)("may never %s on %s, even holding a grant", (action, tool) => {
    expect(decide(["friends"], action, tool, ACTIVE)).toBe("deny");
  });
});

describe("users in neither group", () => {
  it.each([[[]], [[`${POOL}_Google`]]])("groups %j are denied everything", (groups) => {
    expect(decide(groups as string[], "view", "hub")).toBe("deny");
    expect(decide(groups as string[], "newsdesk:ask", "news-desk", ACTIVE)).toBe("deny");
  });
});

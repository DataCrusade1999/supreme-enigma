export type ToolId =
  | "hub"
  | "bgm-looper"
  | "money-planner"
  | "news-desk"
  | "resume-admin"
  | "newsletter-admin"
  | "keystatic"
  | "access-admin";

// The actions Verified Permissions decides on. The Cedar schema in
// infra/shared/cedar/ declares the same twelve; the policy tests fail if they drift.
export const METERED_ACTIONS = ["looper:process", "newsdesk:refresh", "newsdesk:ask"] as const;
export type MeteredAction = (typeof METERED_ACTIONS)[number];
export type ActionId =
  | "view"
  | "newsdesk:pin"
  | MeteredAction
  | "resume:draft"
  | "resume:extract"
  | "resume:publish"
  | "newsletter:send"
  | "keystatic:use"
  | "access:manage";

export function isMetered(action: ActionId): action is MeteredAction {
  return (METERED_ACTIONS as readonly string[]).includes(action);
}

// Every tool the hub lists, in the order it lists them. Three consumers: the
// /tools hub renders a row per entry the viewer may open, the login page's
// "Continuing to → X" strip names the destination from it, and the command bar
// gets an `open <tool>` row per entry. Adding a tool is one entry here, one row
// in ROUTE_ACTIONS below, and the action in the Cedar schema.
export type Tool = {
  id: ToolId;
  href: string;
  name: string;
  kind: string;
  blurb: string;
  /** What opening the page needs; the hub checks it to decide what to list. */
  pageAction: ActionId;
};

export const TOOLS: Tool[] = [
  {
    id: "bgm-looper",
    href: "/tools/bgm-looper",
    name: "BGM Looper",
    kind: "Audio",
    blurb:
      "Find the seamless loop point in a track, crossfade the seam, normalize to −14 LUFS.",
    pageAction: "view",
  },
  {
    id: "resume-admin",
    href: "/tools/resume-admin",
    name: "Resume admin",
    kind: "Site",
    blurb:
      "Upload a resume PDF, check what was read out of it, publish it to the public page.",
    pageAction: "view",
  },
  {
    id: "newsletter-admin",
    href: "/tools/newsletter-admin",
    name: "Newsletter admin",
    kind: "Site",
    blurb:
      "Review an archived newsletter issue and send it to subscribers through Buttondown.",
    pageAction: "view",
  },
  {
    id: "money-planner",
    href: "/tools/money-planner",
    name: "Money Planner",
    kind: "Money",
    blurb:
      "Work out the date a purchase becomes affordable, from a balance, a salary and expenses on their own cadences.",
    pageAction: "view",
  },
  {
    id: "news-desk",
    href: "/tools/news-desk",
    name: "News Desk",
    kind: "News",
    blurb:
      "Headlines on the Indian economy, reforms and legislation from 13 free sources, refreshed when you ask.",
    pageAction: "view",
  },
  {
    id: "keystatic",
    href: "/keystatic",
    name: "Content editor",
    kind: "Site",
    blurb:
      "Write and edit blog posts and newsletter issues. Commits straight to the repo through Keystatic.",
    pageAction: "keystatic:use",
  },
];

export type RouteAction = { tool: ToolId; action: ActionId; consumes: boolean };

type Rule = {
  methods: readonly string[] | "*";
  path: RegExp;
  tool: ToolId;
  action: ActionId;
  /** Takes one use from a metered grant. The looper's upload URL is checked
   * against the grant but doesn't consume it, so a run costs one use. */
  consumes?: boolean;
};

const PAGE = ["GET", "HEAD"] as const;

// Every gated (method, path) and what it needs. A gated request that matches
// nothing here is denied; route-coverage.test.ts fails for any gated route.ts or
// page.tsx without a row.
const ROUTE_ACTIONS: Rule[] = [
  { methods: PAGE, path: /^\/tools$/, tool: "hub", action: "view" },
  { methods: PAGE, path: /^\/tools\/bgm-looper$/, tool: "bgm-looper", action: "view" },
  { methods: ["POST"], path: /^\/api\/looper\/upload-url$/, tool: "bgm-looper", action: "looper:process" },
  { methods: ["POST"], path: /^\/api\/looper\/process$/, tool: "bgm-looper", action: "looper:process", consumes: true },
  { methods: PAGE, path: /^\/tools\/money-planner$/, tool: "money-planner", action: "view" },
  { methods: PAGE, path: /^\/tools\/news-desk$/, tool: "news-desk", action: "view" },
  { methods: ["POST"], path: /^\/api\/news-desk\/indicators$/, tool: "news-desk", action: "newsdesk:pin" },
  { methods: ["DELETE"], path: /^\/api\/news-desk\/indicators\/[^/]+$/, tool: "news-desk", action: "newsdesk:pin" },
  { methods: ["POST"], path: /^\/api\/news-desk\/refresh$/, tool: "news-desk", action: "newsdesk:refresh", consumes: true },
  { methods: ["POST"], path: /^\/api\/news-desk\/ask$/, tool: "news-desk", action: "newsdesk:ask", consumes: true },
  { methods: PAGE, path: /^\/tools\/resume-admin(\/preview\/[^/]+)?$/, tool: "resume-admin", action: "view" },
  { methods: ["GET", "PUT"], path: /^\/api\/resume\/draft$/, tool: "resume-admin", action: "resume:draft" },
  { methods: ["POST"], path: /^\/api\/resume\/upload-url$/, tool: "resume-admin", action: "resume:draft" },
  { methods: ["POST"], path: /^\/api\/resume\/extract$/, tool: "resume-admin", action: "resume:extract" },
  { methods: ["POST"], path: /^\/api\/resume\/publish$/, tool: "resume-admin", action: "resume:publish" },
  { methods: PAGE, path: /^\/tools\/newsletter-admin$/, tool: "newsletter-admin", action: "view" },
  { methods: ["POST"], path: /^\/api\/newsletter\/send$/, tool: "newsletter-admin", action: "newsletter:send" },
  { methods: "*", path: /^\/(api\/)?keystatic(\/.*)?$/, tool: "keystatic", action: "keystatic:use" },
];

export function actionFor(method: string, pathname: string): RouteAction | null {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const verb = method.toUpperCase();
  const rule = ROUTE_ACTIONS.find(
    (r) => (r.methods === "*" || r.methods.includes(verb)) && r.path.test(path),
  );
  return rule ? { tool: rule.tool, action: rule.action, consumes: rule.consumes ?? false } : null;
}

// `/tools` rather than a prefix per tool: the hub itself has to be gated, and
// the whole namespace under it is tools by definition — so a page added there
// is behind the password before anyone remembers to list it. The API prefixes
// stay explicit, since /api/ also holds ungated routes.
const GATED_PREFIXES = [
  "/tools",
  "/api/looper",
  "/api/resume",
  "/api/newsletter",
  "/api/news-desk",
  "/keystatic",
  "/api/keystatic",
];
const ALWAYS_ALLOWED_PATHS = ["/login"];

// Derived from TOOLS so the strip can never name a tool the hub doesn't list,
// or go quiet on one it does. Key order follows TOOLS, which matters to the
// prefix `find()` below. The hub itself is deliberately absent: "Continuing to
// Tools" says less than the no-destination copy the login page already has.
const TOOL_NAMES: Record<string, string> = Object.fromEntries(
  TOOLS.map((tool) => [tool.href, tool.name]),
);

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isGatedPath(pathname: string): boolean {
  if (ALWAYS_ALLOWED_PATHS.includes(pathname)) {
    return false;
  }
  return GATED_PREFIXES.some((prefix) => matches(pathname, prefix));
}

export function toolNameFor(pathname: string): string | null {
  const prefix = Object.keys(TOOL_NAMES).find((candidate) =>
    matches(pathname, candidate),
  );
  return prefix ? TOOL_NAMES[prefix] : null;
}

// Every tool the shared password opens, in the order the hub lists them.
// One list, three consumers: the /tools hub renders a row per entry, the login
// page's "Continuing to → X" strip names the destination from it, and the
// command bar gets an `open <tool>` row per entry. Adding a tool is one entry
// here — as long as its href sits under a gated prefix below.
export type Tool = {
  href: string;
  name: string;
  kind: string;
  blurb: string;
};

export const TOOLS: Tool[] = [
  {
    href: "/tools/bgm-looper",
    name: "BGM Looper",
    kind: "Audio",
    blurb:
      "Find the seamless loop point in a track, crossfade the seam, normalize to −14 LUFS.",
  },
  {
    href: "/tools/resume-admin",
    name: "Resume admin",
    kind: "Site",
    blurb:
      "Upload a resume PDF, check what was read out of it, publish it to the public page.",
  },
  {
    href: "/tools/newsletter-admin",
    name: "Newsletter admin",
    kind: "Site",
    blurb:
      "Review an archived newsletter issue and send it to subscribers through Buttondown.",
  },
  {
    href: "/tools/money-planner",
    name: "Money Planner",
    kind: "Money",
    blurb:
      "Work out the date a purchase becomes affordable, from a balance, a salary and expenses on their own cadences.",
  },
  {
    href: "/tools/news-desk",
    name: "News Desk",
    kind: "News",
    blurb:
      "Headlines on the Indian economy, reforms and legislation from 13 free sources, refreshed when you ask.",
  },
  {
    href: "/keystatic",
    name: "Content editor",
    kind: "Site",
    blurb:
      "Write and edit blog posts and newsletter issues. Commits straight to the repo through Keystatic.",
  },
];

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
const ALWAYS_ALLOWED_PATHS = ["/login", "/api/login"];

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

const GATED_PREFIXES = ["/tools/bgm-looper", "/api/looper", "/keystatic", "/api/keystatic"];
const ALWAYS_ALLOWED_PATHS = ["/login", "/api/login"];

// What the login page calls each destination. Keyed by the same prefixes
// GATED_PREFIXES uses, so adding a tool is one entry in each list — and a
// prefix with no entry here just means the login page shows no destination.
const TOOL_NAMES: Record<string, string> = {
  "/tools/bgm-looper": "BGM Looper",
  "/keystatic": "Content editor",
};

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

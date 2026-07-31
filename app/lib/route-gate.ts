const GATED_PREFIXES = ["/tools/bgm-looper", "/api/looper"];
const ALWAYS_ALLOWED_PATHS = ["/tools/bgm-looper/login", "/api/login"];

export function isGatedPath(pathname: string): boolean {
  if (ALWAYS_ALLOWED_PATHS.includes(pathname)) {
    return false;
  }
  return GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

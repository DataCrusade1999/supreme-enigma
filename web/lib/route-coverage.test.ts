// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { actionFor, isGatedPath } from "./route-gate";

const APP = path.resolve(__dirname, "..", "app");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** app/api/x/[id]/route.ts -> /api/x/sample; route groups "(site)" vanish;
 * [...a] becomes two segments and [[...a]] becomes none. */
function urlFor(file: string): string {
  const segments = path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
    .flatMap((s) => {
      if (s.startsWith("[[...")) return [];
      if (s.startsWith("[...")) return ["a", "b"];
      if (s.startsWith("[")) return ["sample"];
      return [s];
    });
  return "/" + segments.join("/");
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

function methodsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return METHODS.filter((m) =>
    new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+\\{[^}]*\\b${m}\\b[^}]*\\}`).test(source),
  );
}

const files = walk(APP);
const gatedRoutes = files
  .filter((f) => f.endsWith(`${path.sep}route.ts`))
  .map((f) => ({ url: urlFor(f), methods: methodsOf(f), file: path.relative(APP, f) }))
  .filter((r) => isGatedPath(r.url));
const gatedPages = files
  .filter((f) => f.endsWith(`${path.sep}page.tsx`))
  .map((f) => ({ url: urlFor(f), file: path.relative(APP, f) }))
  .filter((p) => isGatedPath(p.url));

describe("every gated route has an action", () => {
  it("finds the gated routes and pages", () => {
    expect(gatedRoutes.length).toBeGreaterThan(10);
    expect(gatedPages.length).toBeGreaterThan(5);
  });

  it.each(gatedRoutes.flatMap((r) => r.methods.map((m) => [m, r.url, r.file])))("%s %s (%s)", (method, url) => {
    expect(actionFor(method, url)).not.toBeNull();
  });

  it.each(gatedPages.map((p) => [p.url, p.file]))("GET %s (%s)", (url) => {
    expect(actionFor("GET", url)).not.toBeNull();
  });
});

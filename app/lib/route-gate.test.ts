import { describe, expect, it } from "vitest";
import { isGatedPath, toolNameFor } from "./route-gate";

describe("isGatedPath", () => {
  it.each([
    ["/", false],
    ["/about", false],
    ["/projects", false],
    ["/resume", false],
    ["/contact", false],
    ["/tools/bgm-looper", true],
    ["/tools/bgm-looper/", true],
    ["/login", false],
    ["/api/login", false],
    // The old login path moved to /login and is no longer carved out, so it
    // now falls under the /tools/bgm-looper prefix like any other subpath.
    ["/tools/bgm-looper/login", true],
    ["/api/looper/process", true],
    ["/api/looper/upload-url", true],
    ["/keystatic", true],
    ["/keystatic/blog/hello-world", true],
    ["/api/keystatic/github/oauth/callback", true],
  ])("isGatedPath(%s) === %s", (pathname, expected) => {
    expect(isGatedPath(pathname)).toBe(expected);
  });
});

describe("toolNameFor", () => {
  it.each([
    ["/tools/bgm-looper", "BGM Looper"],
    ["/tools/bgm-looper/", "BGM Looper"],
    ["/keystatic", "Content editor"],
    ["/keystatic/blog/hello-world", "Content editor"],
    // Nothing to name: the login page drops the destination strip rather than
    // printing a raw path back at the visitor.
    // A query or hash straight after the prefix has no "/" separator, so the
    // caller has to hand this a bare pathname — see app/login/page.tsx.
    ["/keystatic?path=posts", null],
    ["/tools/bgm-looper#top", null],
    ["/", null],
    ["/about", null],
    ["/tools/something-new", null],
    ["/api/looper/process", null],
  ])("toolNameFor(%s) === %s", (pathname, expected) => {
    expect(toolNameFor(pathname)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { isGatedPath } from "./route-gate";

describe("isGatedPath", () => {
  it.each([
    ["/", false],
    ["/about", false],
    ["/projects", false],
    ["/resume", false],
    ["/contact", false],
    ["/keystatic", false],
    ["/tools/bgm-looper", true],
    ["/tools/bgm-looper/", true],
    ["/tools/bgm-looper/login", false],
    ["/api/login", false],
    ["/api/looper/process", true],
    ["/api/looper/upload-url", true],
  ])("isGatedPath(%s) === %s", (pathname, expected) => {
    expect(isGatedPath(pathname)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { actionFor, isGatedPath, isMetered, toolNameFor, TOOLS } from "./route-gate";

describe("isGatedPath", () => {
  it.each([
    ["/", false],
    ["/about", false],
    ["/projects", false],
    ["/resume", false],
    ["/contact", false],
    ["/tools/bgm-looper", true],
    ["/tools/bgm-looper/", true],
    // The hub itself is gated, and so is the whole namespace under it — a
    // future tool is behind the password before anyone remembers to list it.
    ["/tools", true],
    ["/tools/", true],
    ["/tools/something-new", true],
    ["/login", false],
    ["/api/auth/login", false],
    ["/api/auth/callback", false],
    // The old login path moved to /login and is no longer carved out, so it
    // now falls under the /tools/bgm-looper prefix like any other subpath.
    ["/tools/bgm-looper/login", true],
    ["/api/looper/process", true],
    ["/api/looper/upload-url", true],
    ["/keystatic", true],
    ["/keystatic/blog/hello-world", true],
    ["/api/keystatic/github/oauth/callback", true],
    ["/api/newsletter", true],
    ["/api/newsletter/send", true],
    ["/api/news-desk/refresh", true],
    ["/tools/news-desk", true],
    // Gated by the /tools prefix rather than an entry of its own — this case
    // is here to pin that, so moving the admin out of /tools fails loudly.
    ["/tools/newsletter-admin", true],
    // The public archive stays public, like /blog.
    ["/newsletter", false],
    ["/newsletter/hello-newsletter", false],
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
    // The hub is not itself a tool: naming it would put "Continuing to Tools"
    // on the gate, where the no-destination copy already says it better.
    ["/tools", null],
    ["/tools/something-new", null],
    ["/api/looper/process", null],
    ["/tools/newsletter-admin", "Newsletter admin"],
    ["/tools/news-desk", "News Desk"],
  ])("toolNameFor(%s) === %s", (pathname, expected) => {
    expect(toolNameFor(pathname)).toBe(expected);
  });
});

describe("resume admin gating", () => {
  it("gates the admin page and its sub-paths", () => {
    expect(isGatedPath("/tools/resume-admin")).toBe(true);
    expect(isGatedPath("/tools/resume-admin/preview/abc")).toBe(true);
  });

  it("gates the resume API", () => {
    expect(isGatedPath("/api/resume/upload-url")).toBe(true);
    expect(isGatedPath("/api/resume/extract")).toBe(true);
    expect(isGatedPath("/api/resume/publish")).toBe(true);
  });

  it("leaves the public resume page and PDF ungated", () => {
    // These are the visitor-facing pages Phase 3 builds. Gating them by an
    // over-broad prefix match would hide the portfolio behind the password.
    expect(isGatedPath("/resume")).toBe(false);
    expect(isGatedPath("/resume.pdf")).toBe(false);
  });

  it("names the destination on the login gate", () => {
    expect(toolNameFor("/tools/resume-admin")).toBe("Resume admin");
  });
});

describe("TOOLS", () => {
  it("lists every tool the hub offers", () => {
    expect(TOOLS.map((tool) => tool.href)).toEqual([
      "/tools/bgm-looper",
      "/tools/resume-admin",
      "/tools/newsletter-admin",
      "/tools/money-planner",
      "/tools/news-desk",
      "/keystatic",
    ]);
  });

  it("is the source the destination strip names tools from", () => {
    for (const tool of TOOLS) {
      expect(toolNameFor(tool.href)).toBe(tool.name);
    }
  });

  it("only lists gated destinations", () => {
    for (const tool of TOOLS) {
      expect(isGatedPath(tool.href)).toBe(true);
    }
  });

  it("gives every tool a kind and a blurb for the hub row", () => {
    for (const tool of TOOLS) {
      expect(tool.kind).not.toBe("");
      expect(tool.blurb).not.toBe("");
    }
  });
});

describe("actionFor", () => {
  it.each([
    ["GET", "/tools", "hub", "view", false],
    ["GET", "/tools/bgm-looper", "bgm-looper", "view", false],
    ["POST", "/api/looper/upload-url", "bgm-looper", "looper:process", false],
    ["POST", "/api/looper/process", "bgm-looper", "looper:process", true],
    ["GET", "/tools/money-planner", "money-planner", "view", false],
    ["GET", "/tools/news-desk", "news-desk", "view", false],
    ["POST", "/api/news-desk/indicators", "news-desk", "newsdesk:pin", false],
    ["DELETE", "/api/news-desk/indicators/cpi-food", "news-desk", "newsdesk:pin", false],
    ["POST", "/api/news-desk/refresh", "news-desk", "newsdesk:refresh", true],
    ["POST", "/api/news-desk/ask", "news-desk", "newsdesk:ask", true],
    ["GET", "/tools/resume-admin", "resume-admin", "view", false],
    ["GET", "/tools/resume-admin/preview/abc123", "resume-admin", "view", false],
    ["GET", "/api/resume/draft", "resume-admin", "resume:draft", false],
    ["PUT", "/api/resume/draft", "resume-admin", "resume:draft", false],
    ["POST", "/api/resume/upload-url", "resume-admin", "resume:draft", false],
    ["POST", "/api/resume/extract", "resume-admin", "resume:extract", false],
    ["POST", "/api/resume/publish", "resume-admin", "resume:publish", false],
    ["GET", "/tools/newsletter-admin", "newsletter-admin", "view", false],
    ["POST", "/api/newsletter/send", "newsletter-admin", "newsletter:send", false],
    ["GET", "/keystatic", "keystatic", "keystatic:use", false],
    ["GET", "/keystatic/blog/hello", "keystatic", "keystatic:use", false],
    ["POST", "/api/keystatic/github/oauth/callback", "keystatic", "keystatic:use", false],
  ])("%s %s -> %s %s (consumes: %s)", (method, path, tool, action, consumes) => {
    expect(actionFor(method, path)).toEqual({ tool, action, consumes });
  });

  it("treats HEAD like GET and ignores a trailing slash", () => {
    expect(actionFor("HEAD", "/tools/news-desk")).toEqual({ tool: "news-desk", action: "view", consumes: false });
    expect(actionFor("GET", "/tools/news-desk/")).toEqual({ tool: "news-desk", action: "view", consumes: false });
    expect(actionFor("get", "/tools")).toEqual({ tool: "hub", action: "view", consumes: false });
  });

  it.each([
    ["POST", "/tools/news-desk"],
    ["GET", "/api/news-desk/ask"],
    ["DELETE", "/api/news-desk/indicators"],
    ["GET", "/tools/something-new"],
    ["GET", "/api/looper/anything"],
  ])("leaves %s %s unmapped, so the proxy denies it", (method, path) => {
    expect(actionFor(method, path)).toBeNull();
  });
});

describe("isMetered", () => {
  it("is true for exactly the three metered actions", () => {
    expect(["looper:process", "newsdesk:refresh", "newsdesk:ask"].every((a) => isMetered(a as never))).toBe(true);
    expect(isMetered("view")).toBe(false);
    expect(isMetered("resume:extract")).toBe(false);
  });
});

describe("TOOLS", () => {
  it("gives every tool the action its page needs", () => {
    for (const tool of TOOLS) {
      expect(actionFor("GET", tool.href)).toMatchObject({ tool: tool.id, action: tool.pageAction });
    }
  });
});

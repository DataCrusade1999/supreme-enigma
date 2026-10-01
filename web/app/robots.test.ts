import { describe, expect, it } from "vitest";
import robots from "./robots";

const rules = () => {
  const r = robots().rules;
  return Array.isArray(r) ? r : [r];
};

describe("robots.txt", () => {
  it("disallows the whole site for AI crawlers", () => {
    const ai = rules().find((rule) => Array.isArray(rule.userAgent));
    expect(ai?.disallow).toBe("/");
    expect(ai?.userAgent).toEqual(
      expect.arrayContaining(["GPTBot", "ClaudeBot", "Google-Extended", "CCBot"]),
    );
  });

  it("lets other crawlers index public pages but not the gated areas", () => {
    const rest = rules().find((rule) => rule.userAgent === "*");
    expect(rest?.allow).toBe("/");
    expect(rest?.disallow).toEqual(
      expect.arrayContaining(["/tools", "/api/", "/keystatic", "/login"]),
    );
  });
});

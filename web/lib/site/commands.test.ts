import { describe, expect, it, vi, beforeEach } from "vitest";
import { COMMANDS } from "./commands";

describe("COMMANDS", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("has one command per nav destination, every tool, and a theme toggle", () => {
    expect(COMMANDS.map((command) => command.id)).toEqual([
      "cd-home",
      "cd-about",
      "cd-projects",
      "cd-resume",
      "cd-blog",
      "cd-newsletter",
      "cd-contact",
      "cd-tools",
      "open-bgm-looper",
      "open-resume-admin",
      "open-newsletter-admin",
      "open-money-planner",
      "open-content-editor",
      "theme",
    ]);
  });

  it("pins six commands for the empty command bar", () => {
    expect(COMMANDS.filter((command) => command.pinned).map((command) => command.id)).toEqual([
      "cd-projects",
      "cd-resume",
      "cd-blog",
      "cd-contact",
      "cd-tools",
      "theme",
    ]);
  });

  it("cd commands push their href", () => {
    const push = vi.fn();
    const projects = COMMANDS.find((command) => command.id === "cd-projects");
    projects?.run({ push });
    expect(push).toHaveBeenCalledWith("/projects");
  });

  // Every gated destination is reachable by name, not just the one that has a
  // header button — ⌘K is the only nav the tool pages themselves carry.
  it.each([
    ["cd-tools", "/tools"],
    ["open-bgm-looper", "/tools/bgm-looper"],
    ["open-resume-admin", "/tools/resume-admin"],
    ["open-newsletter-admin", "/tools/newsletter-admin"],
    ["open-money-planner", "/tools/money-planner"],
    ["open-content-editor", "/keystatic"],
  ])("%s pushes %s", (id, href) => {
    const push = vi.fn();
    COMMANDS.find((command) => command.id === id)?.run({ push });
    expect(push).toHaveBeenCalledWith(href);
  });

  it("theme switches dark to light and persists the choice", () => {
    document.documentElement.classList.add("dark");
    COMMANDS.find((command) => command.id === "theme")?.run({ push: vi.fn() });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("theme switches light to dark and persists the choice", () => {
    COMMANDS.find((command) => command.id === "theme")?.run({ push: vi.fn() });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});

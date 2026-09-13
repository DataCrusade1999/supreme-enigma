import { describe, expect, it, vi, beforeEach } from "vitest";
import { COMMANDS } from "./commands";

describe("COMMANDS", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("has one command per nav destination, every tool, and both theme choices", () => {
    expect(COMMANDS.map((command) => command.id)).toEqual([
      "cd-home",
      "cd-about",
      "cd-projects",
      "cd-resume",
      "cd-blog",
      "cd-contact",
      "cd-tools",
      "open-bgm-looper",
      "open-resume-admin",
      "open-content-editor",
      "theme-dark",
      "theme-light",
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
    ["open-content-editor", "/keystatic"],
  ])("%s pushes %s", (id, href) => {
    const push = vi.fn();
    COMMANDS.find((command) => command.id === id)?.run({ push });
    expect(push).toHaveBeenCalledWith(href);
  });

  it("theme-dark sets the dark class and persists the choice", () => {
    const push = vi.fn();
    const themeDark = COMMANDS.find((command) => command.id === "theme-dark");
    themeDark?.run({ push });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("theme-light removes the dark class and persists the choice", () => {
    document.documentElement.classList.add("dark");
    const push = vi.fn();
    const themeLight = COMMANDS.find((command) => command.id === "theme-light");
    themeLight?.run({ push });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });
});

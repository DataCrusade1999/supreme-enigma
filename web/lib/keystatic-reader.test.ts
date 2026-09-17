import { describe, expect, it } from "vitest";
import { getReader } from "./keystatic-reader";

describe("getReader", () => {
  it("resolves content/blog relative to the repo root (not web/) and finds the seed post", async () => {
    const reader = getReader();
    const slugs = await reader.collections.blog.list();
    expect(slugs).toContain("hello-world");

    const entry = await reader.collections.blog.readOrThrow("hello-world");
    expect(entry.title).toBe("Hello, World");
    expect(entry.summary).toContain("Keystatic");
    expect(entry.tags).toContain("meta");

    const body = await entry.content();
    expect(body).toContain("first post");
  });
});

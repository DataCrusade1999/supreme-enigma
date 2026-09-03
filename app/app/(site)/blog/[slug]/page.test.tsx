import { describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("notFound() called");
});
vi.mock("next/navigation", () => ({ notFound }));

const { default: PostPage } = await import("./page");

describe("PostPage", () => {
  it("calls notFound() for an unknown slug", async () => {
    await expect(
      PostPage({ params: Promise.resolve({ slug: "does-not-exist" }) }),
    ).rejects.toThrow("notFound() called");
    expect(notFound).toHaveBeenCalled();
  });
});

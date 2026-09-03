import { describe, expect, it } from "vitest";
import PostPage from "./page";

describe("PostPage", () => {
  it("calls notFound() for an unknown slug", async () => {
    // notFound() throws Next's 404 fallback error; matching on it keeps this
    // from passing on an unrelated throw.
    await expect(
      PostPage({ params: Promise.resolve({ slug: "does-not-exist" }) }),
    ).rejects.toThrow(/404/);
  });
});

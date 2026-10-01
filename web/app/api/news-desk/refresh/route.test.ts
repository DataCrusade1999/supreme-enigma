import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/news-desk/refresh", () => ({ runRefresh: vi.fn() }));

import { runRefresh } from "@/lib/news-desk/refresh";
import { maxDuration, POST } from "./route";

describe("POST /api/news-desk/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "audio-bucket";
  });

  it("returns the new snapshot", async () => {
    const snapshot = { version: 1, refreshedAt: "x", headlines: [], indicators: [], sourceErrors: [] };
    vi.mocked(runRefresh).mockResolvedValue(snapshot as never);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(snapshot);
  });

  it("answers 503 when no bucket is configured, without fetching anything", async () => {
    delete process.env.S3_BUCKET_NAME;
    const res = await POST();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "storage not configured" });
    expect(runRefresh).not.toHaveBeenCalled();
  });

  it("answers 500 with a readable body when S3 fails", async () => {
    vi.mocked(runRefresh).mockRejectedValue(new Error("AccessDenied"));
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "refresh failed" });
  });

  it("allows the full 60 seconds", () => {
    expect(maxDuration).toBe(60);
  });
});

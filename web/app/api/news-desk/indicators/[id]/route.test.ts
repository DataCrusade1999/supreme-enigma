// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/news-desk/pins", async () => {
  const actual = await vi.importActual<typeof import("@/lib/news-desk/pins")>("@/lib/news-desk/pins");
  return { ...actual, unpinIndicator: vi.fn() };
});

import { PinError, unpinIndicator } from "@/lib/news-desk/pins";
import { DELETE } from "./route";

const del = (id: string) =>
  DELETE(new Request(`http://localhost/api/news-desk/indicators/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

describe("DELETE /api/news-desk/indicators/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "audio-bucket";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("unpins", async () => {
    const res = await del("pin-abc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(unpinIndicator).toHaveBeenCalledWith("pin-abc");
  });

  it("passes on a pin error's status", async () => {
    vi.mocked(unpinIndicator).mockRejectedValue(new PinError("default indicators cannot be removed", 400));
    const res = await del("cpi-headline");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "default indicators cannot be removed" });
  });

  it("says nothing changed when S3 fails", async () => {
    vi.mocked(unpinIndicator).mockRejectedValue(new Error("Access Denied"));
    expect((await del("pin-abc")).status).toBe(500);
  });
});

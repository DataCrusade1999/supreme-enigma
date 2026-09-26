// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/news-desk/pins", async () => {
  const actual = await vi.importActual<typeof import("@/lib/news-desk/pins")>("@/lib/news-desk/pins");
  return { ...actual, pinIndicator: vi.fn() };
});

import { PinError, pinIndicator } from "@/lib/news-desk/pins";
import { POST } from "./route";

const INPUT = { label: "IIP manufacturing", dataset: "IIP", filters: { type: "Sectoral" }, valueField: "growth_rate", unit: "%" };
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/news-desk/indicators", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/news-desk/indicators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "audio-bucket";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("pins and returns the new row", async () => {
    const row = { id: "pin-abc", label: "IIP manufacturing", unit: "%", period: null, latest: null, prevPeriod: null, prev: null, lastGoodAt: null };
    vi.mocked(pinIndicator).mockResolvedValue(row);
    const res = await post(INPUT);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ indicator: row });
    expect(pinIndicator).toHaveBeenCalledWith(INPUT);
  });

  it.each([[{ ...INPUT, label: "" }], [{ ...INPUT, filters: "x" }], [{}]])("rejects %j", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(pinIndicator).not.toHaveBeenCalled();
  });

  it("passes on a pin error's status", async () => {
    vi.mocked(pinIndicator).mockRejectedValue(new PinError("already pinned", 409));
    const res = await post(INPUT);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already pinned" });
  });

  it("says nothing changed when S3 fails", async () => {
    vi.mocked(pinIndicator).mockRejectedValue(new Error("Access Denied"));
    const res = await post(INPUT);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "could not read or write the pinned indicators; nothing changed" });
  });

  it("answers 503 when no bucket is configured", async () => {
    delete process.env.S3_BUCKET_NAME;
    expect((await post(INPUT)).status).toBe(503);
  });
});

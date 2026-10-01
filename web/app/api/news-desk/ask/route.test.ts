// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/news-desk/ask", () => ({ ask: vi.fn(), isAskConfigured: vi.fn() }));

import { ask, isAskConfigured } from "@/lib/news-desk/ask";
import type { AskEvent } from "@/lib/news-desk/chat-types";
import { maxDuration, POST } from "./route";

function post(body: unknown) {
  return new Request("http://localhost/api/news-desk/ask", { method: "POST", body: JSON.stringify(body) });
}
async function* events(...list: AskEvent[]) {
  for (const e of list) yield e;
}

describe("POST /api/news-desk/ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAskConfigured).mockReturnValue(true);
  });

  it("streams each event as one line of JSON", async () => {
    vi.mocked(ask).mockReturnValue(
      events({ type: "step", label: "Reading CPI filters…" }, { type: "answer", text: "4.82%", chart: null, pinnable: false, query: null }),
    );
    const res = await POST(post({ question: "  CPI?  " }));
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: "step", label: "Reading CPI filters…" },
      { type: "answer", text: "4.82%", chart: null, pinnable: false, query: null },
    ]);
    expect(ask).toHaveBeenCalledWith("CPI?");
  });

  it("turns an unexpected failure into a final error line", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(ask).mockReturnValue(
      (async function* () {
        yield { type: "step", label: "Reading CPI filters…" } as AskEvent;
        throw new Error("boom");
      })(),
    );
    const lines = (await (await POST(post({ question: "CPI?" }))).text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.at(-1)).toEqual({ type: "error", message: "The assistant failed unexpectedly." });
  });

  it.each([[{ question: "" }], [{ question: "x".repeat(501) }], [{}], ["not json"]])("rejects %j", async (body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "question must be 1 to 500 characters" });
    expect(ask).not.toHaveBeenCalled();
  });

  it("answers 503 when no model is configured", async () => {
    vi.mocked(isAskConfigured).mockReturnValue(false);
    const res = await POST(post({ question: "CPI?" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "assistant not configured" });
  });

  it("allows the full 60 seconds", () => {
    expect(maxDuration).toBe(60);
  });
});

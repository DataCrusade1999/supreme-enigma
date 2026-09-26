import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";

const ANSWER = {
  type: "answer",
  text: "IIP grew 6.7% in July 2026.",
  chart: { title: "IIP growth", unit: "%", points: [{ period: "Jun 2026", value: 8.8 }, { period: "Jul 2026", value: 6.7 }] },
  pinnable: true,
  query: { title: "IIP growth", unit: "%", dataset: "IIP", filters: { type: "General" }, valueField: "growth_rate" },
};

function ndjson(...events: unknown[]) {
  return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { status: 200 });
}
function open() {
  render(<ChatPanel onPinned={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Ask MoSPI" }));
}
function askQuestion(q: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), { target: { value: q } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

describe("ChatPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens and closes", () => {
    open();
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveAttribute("placeholder", "Each question is answered on its own.");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("textbox", { name: "Question" })).not.toBeInTheDocument();
  });

  it("shows the steps, the answer and the chart", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson({ type: "step", label: "Reading IIP filters…" }, ANSWER)));
    open();
    askQuestion("How is industrial output doing?");
    expect(await screen.findByText("IIP grew 6.7% in July 2026.")).toBeInTheDocument();
    expect(screen.getByText("Reading IIP filters…")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /IIP growth/ })).toBeInTheDocument();
    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ question: "How is industrial output doing?" });
  });

  it("keeps the steps and shows the error when the stream ends in one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjson({ type: "step", label: "Fetching CPI data…" }, { type: "error", message: "MoSPI is not responding: MoSPI status 503" })),
    );
    open();
    askQuestion("CPI?");
    expect(await screen.findByText("MoSPI is not responding: MoSPI status 503")).toBeInTheDocument();
    expect(screen.getByText("Fetching CPI data…")).toBeInTheDocument();
  });

  it("says the answer did not arrive when the stream stops early", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson({ type: "step", label: "Fetching CPI data…" })));
    open();
    askQuestion("CPI?");
    expect(await screen.findByText("The answer did not arrive.")).toBeInTheDocument();
    expect(screen.getByText("Fetching CPI data…")).toBeInTheDocument();
  });

  it("shows the answer as plain text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson({ ...ANSWER, text: "<b>bold</b>", chart: null, pinnable: false, query: null })));
    open();
    askQuestion("CPI?");
    expect(await screen.findByText("<b>bold</b>")).toBeInTheDocument();
  });

  it("pins the chart under the edited name", async () => {
    const onPinned = vi.fn();
    const row = { id: "pin-abc", label: "Industrial output", unit: "%", period: null, latest: null, prevPeriod: null, prev: null, lastGoodAt: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/news-desk/ask" ? ndjson(ANSWER) : new Response(JSON.stringify({ indicator: row }), { status: 201 }),
      ),
    );
    render(<ChatPanel onPinned={onPinned} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask MoSPI" }));
    askQuestion("IIP?");
    fireEvent.change(await screen.findByRole("textbox", { name: "Indicator name" }), { target: { value: "Industrial output" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(onPinned).toHaveBeenCalledWith(row));
    const [, init] = vi.mocked(fetch).mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      label: "Industrial output",
      dataset: "IIP",
      filters: { type: "General" },
      valueField: "growth_rate",
      unit: "%",
    });
    expect(screen.getByText("Pinned. It fills in on the next Refresh.")).toBeInTheDocument();
  });

  it("says why a pin failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/news-desk/ask" ? ndjson(ANSWER) : new Response(JSON.stringify({ error: "already pinned" }), { status: 409 }),
      ),
    );
    open();
    askQuestion("IIP?");
    fireEvent.click(await screen.findByRole("button", { name: "Pin" }));
    expect(await screen.findByText("Could not pin: already pinned")).toBeInTheDocument();
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mospi", async () => {
  const actual = await vi.importActual<typeof import("./mospi")>("./mospi");
  return { ...actual, callTool: vi.fn() };
});
vi.mock("./indicators", () => ({ fetchSeries: vi.fn() }));

import { ask } from "./ask";
import type { AskEvent } from "./chat-types";
import { compactMetadata } from "./compact";
import { fetchSeries } from "./indicators";
import { callTool, MospiError, MospiUnavailableError } from "./mospi";

const metadata = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "mospi", "metadata-iip.json"), "utf8"),
);

type Sent = {
  tool_choice: unknown;
  max_tokens: number;
  tools: { function: { name: string } }[];
  messages: { role: string; content: string | null; tool_call_id?: string }[];
};

let fetchMock: ReturnType<typeof vi.fn>;
function sent(call: number): Sent {
  const [, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string);
}

let callId = 0;
function toolReply(name: string, args: unknown, promptTokens = 1000) {
  callId++;
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: `c${callId}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
          },
        },
      ],
      usage: { prompt_tokens: promptTokens, cost: 0.001 },
    }),
  );
}
function textReply(text: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 500, cost: 0.0005 } }),
  );
}
function script(...replies: Response[]) {
  fetchMock = vi.fn(async () => replies.shift() ?? textReply("script ran out"));
  vi.stubGlobal("fetch", fetchMock);
}
async function collect(gen: AsyncGenerator<AskEvent>): Promise<AskEvent[]> {
  const events: AskEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const CHART = {
  title: "IIP growth",
  unit: "%",
  dataset: "IIP",
  filters: { base_year: "2022-23", frequency: "Monthly", type: "General", limit: "100", page: "1" },
  valueField: "growth_rate",
};
const POINTS = [
  { period: "Jun 2026", value: 8.8 },
  { period: "Jul 2026", value: 6.7 },
];

describe("ask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.example/api/v1";
    process.env.NEWS_DESK_MODEL = "anthropic/claude-haiku-4.5";
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(callTool).mockResolvedValue(metadata);
    vi.mocked(fetchSeries).mockResolvedValue(POINTS);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams a step per MoSPI call, then an answer whose chart the server fetched", async () => {
    script(toolReply("get_metadata", { dataset: "IIP", base_year: "2022-23" }), toolReply("answer", { text: "IIP grew 6.7% in July 2026.", chart: CHART }));

    const events = await collect(ask("How is industrial output doing?"));

    expect(events).toEqual([
      { type: "step", label: "Reading IIP filters…" },
      { type: "step", label: "Drawing the chart…" },
      {
        type: "answer",
        text: "IIP grew 6.7% in July 2026.",
        chart: { title: "IIP growth", unit: "%", points: POINTS },
        pinnable: true,
        query: {
          title: "IIP growth",
          unit: "%",
          dataset: "IIP",
          filters: { base_year: "2022-23", frequency: "Monthly", type: "General" },
          valueField: "growth_rate",
        },
      },
    ]);
    // limit and page are the server's to set, not the model's.
    expect(vi.mocked(fetchSeries).mock.calls[0][0]).toMatchObject({
      dataset: "IIP",
      filters: { base_year: "2022-23", frequency: "Monthly", type: "General" },
      valueField: "growth_rate",
    });
    // The metadata went back to the model compacted.
    const toolMessage = sent(1).messages.find((m) => m.role === "tool")!;
    expect(toolMessage.content).toBe(compactMetadata(metadata));
  });

  it("sends only the question, with the tools, a 1,500-token cap and tool_choice auto", async () => {
    script(toolReply("answer", { text: "I can only answer questions about Indian official statistics.", chart: null }));
    await collect(ask("Who won the match?"));
    const body = sent(0);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[1].content).toBe("Who won the match?");
    expect(body.max_tokens).toBe(1500);
    expect(body.tool_choice).toBe("auto");
    expect(body.tools.map((t) => t.function.name).sort()).toEqual(
      ["answer", "get_data", "get_indicators", "get_metadata", "list_datasets"],
    );
  });

  it("answers without a chart, and not pinnable, when the chart query does not give one series", async () => {
    vi.mocked(fetchSeries).mockRejectedValue(new Error("two rows for Aug 2026; the filters match more than one series"));
    script(toolReply("answer", { text: "Food inflation was 5.66%.", chart: { ...CHART, dataset: "CPI" } }));
    const events = await collect(ask("Food inflation?"));
    expect(events.at(-1)).toEqual({ type: "answer", text: "Food inflation was 5.66%.", chart: null, pinnable: false, query: null });
  });

  it("forces the answer tool once 8 MoSPI calls have been made", async () => {
    script(...Array.from({ length: 8 }, () => toolReply("get_data", { dataset: "CPI", filters: {} })), toolReply("answer", { text: "Best effort.", chart: null }));
    const events = await collect(ask("Everything about CPI"));
    expect(callTool).toHaveBeenCalledTimes(8);
    expect(sent(8).tool_choice).toEqual({ type: "function", function: { name: "answer" } });
    expect(events.at(-1)).toMatchObject({ type: "answer", text: "Best effort." });
  });

  it("forces the answer tool once the input budget is spent", async () => {
    script(toolReply("list_datasets", {}, 125_000), toolReply("answer", { text: "Done.", chart: null }));
    await collect(ask("Datasets?"));
    expect(sent(1).tool_choice).toEqual({ type: "function", function: { name: "answer" } });
  });

  it("forces the answer tool after 30 s", async () => {
    const times = [0, 0, 31_000, 31_000];
    const clock = () => times.shift() ?? 31_000;
    script(toolReply("list_datasets", {}), toolReply("answer", { text: "Done.", chart: null }));
    await collect(ask("Datasets?", clock));
    expect(sent(1).tool_choice).toEqual({ type: "function", function: { name: "answer" } });
  });

  it("ends with an error, not a cut stream, when time runs out", async () => {
    const times = [0, 0, 53_000];
    const clock = () => times.shift() ?? 53_000;
    script(toolReply("list_datasets", {}));
    const events = await collect(ask("Datasets?", clock));
    expect(events.at(-1)).toEqual({ type: "error", message: "The question took too long to answer. Try a narrower question." });
  });

  it("asks once more for the answer tool after a plain reply", async () => {
    script(textReply("Let me think."), toolReply("answer", { text: "Done.", chart: null }));
    const events = await collect(ask("Datasets?"));
    expect(sent(1).messages.at(-1)).toEqual({ role: "user", content: "Call the answer tool now with your answer." });
    expect(events.at(-1)).toMatchObject({ type: "answer", text: "Done." });
  });

  it("ends with an error after a second plain reply", async () => {
    script(textReply("Hmm."), textReply("Still thinking."));
    const events = await collect(ask("Datasets?"));
    expect(events.at(-1)).toEqual({ type: "error", message: "The assistant did not give an answer." });
  });

  it("returns a rejected MoSPI call to the model so it can correct it", async () => {
    vi.mocked(callTool).mockRejectedValueOnce(new MospiError("MoSPI rejected the query: Invalid parameters"));
    script(toolReply("get_data", { dataset: "CPI", filters: {} }), toolReply("answer", { text: "Done.", chart: null }));
    const events = await collect(ask("CPI?"));
    const toolMessage = sent(1).messages.find((m) => m.role === "tool")!;
    expect(toolMessage.content).toBe("MoSPI rejected this call: MoSPI rejected the query: Invalid parameters");
    expect(events.at(-1)).toMatchObject({ type: "answer" });
  });

  it("ends with an error when MoSPI cannot be reached", async () => {
    vi.mocked(callTool).mockRejectedValueOnce(new MospiUnavailableError("MoSPI status 503"));
    script(toolReply("get_data", { dataset: "CPI", filters: {} }));
    const events = await collect(ask("CPI?"));
    expect(events).toEqual([
      { type: "step", label: "Fetching CPI data…" },
      { type: "error", message: "MoSPI is not responding: MoSPI status 503" },
    ]);
  });

  it("ends with an error when OpenRouter fails", async () => {
    script(new Response("upstream", { status: 502 }));
    const events = await collect(ask("CPI?"));
    expect(events).toEqual([{ type: "error", message: "The assistant is not responding: OpenRouter status 502" }]);
  });

  it("ends with an error when the answer cannot be read", async () => {
    script(toolReply("answer", { chart: null }));
    const events = await collect(ask("CPI?"));
    expect(events).toEqual([{ type: "error", message: "The assistant's answer could not be read." }]);
  });

  it("does not pass user_query on to MoSPI", async () => {
    script(toolReply("get_metadata", { dataset: "IIP", user_query: "How is industrial output doing?" }), toolReply("answer", { text: "Done.", chart: null }));
    await collect(ask("How is industrial output doing?"));
    expect(callTool).toHaveBeenCalledWith("get_metadata", { dataset: "IIP" });
  });
});

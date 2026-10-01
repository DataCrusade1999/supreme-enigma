import type { AskEvent, ChartQuery } from "./chat-types";
import { capResult, compactMetadata } from "./compact";
import { fetchSeries } from "./indicators";
import { callTool, MospiError, MospiUnavailableError } from "./mospi";
import { ANSWER_TOOL, answerArgsSchema, isMospiTool, mospiToolDefinitions, stepLabel } from "./mospi-tools";
import type { Point } from "./series";

// Spec §7.2 step 5.
const MAX_MOSPI_CALLS = 8;
const MAX_TOKENS = 1_500;
const INPUT_BUDGET = 120_000;
// The route has 60 s. Past the soft deadline the next turn must answer; past the
// hard one the stream ends with an error rather than being cut off by Vercel.
const SOFT_DEADLINE_MS = 30_000;
const HARD_DEADLINE_MS = 55_000;
const MIN_TURN_MS = 3_000;
const TURN_TIMEOUT_MS = 15_000;

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

function systemPrompt(today: string): string {
  return `You answer questions about Indian official statistics using MoSPI's data tools. Today is ${today}.
- Answer only questions about Indian official statistics. For anything else, call answer saying that is all you can answer.
- Find data in this order: list_datasets, get_indicators, get_metadata, get_data. Skip a step only when an earlier result already gives what it would.
- Use the latest base year unless the question asks for another.
- Use filter codes exactly as get_metadata returns them. Put limit and page inside filters; limit is at most 100.
- State only numbers that appear in tool results, with their period. Do not estimate or recall figures.
- When you have the answer, or cannot find it, call answer.`;
}

export function isAskConfigured(): boolean {
  const { OPENROUTER_API_KEY, OPENROUTER_BASE_URL, NEWS_DESK_MODEL } = process.env;
  return Boolean(OPENROUTER_API_KEY && OPENROUTER_BASE_URL && NEWS_DESK_MODEL);
}

async function chat(messages: Message[], forced: boolean, timeoutMs: number) {
  const res = await fetch(`${process.env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: process.env.NEWS_DESK_MODEL,
      max_tokens: MAX_TOKENS,
      usage: { include: true },
      tools: [...mospiToolDefinitions(), ANSWER_TOOL],
      tool_choice: forced ? { type: "function", function: { name: "answer" } } : "auto",
      messages,
    }),
  });
  // Status before body: an edge 429 or 5xx is HTML. The key is never echoed.
  if (!res.ok) throw new Error(`OpenRouter status ${res.status}`);
  const json = await res.json();
  const message = json?.choices?.[0]?.message as { content?: string | null; tool_calls?: ToolCall[] } | undefined;
  if (!message) throw new Error("OpenRouter returned no message");
  const promptTokens = json?.usage?.prompt_tokens;
  const cost = json?.usage?.cost;
  return {
    message,
    promptTokens: typeof promptTokens === "number" ? promptTokens : 0,
    costUsd: typeof cost === "number" ? cost : 0,
  };
}

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), Math.max(0, ms))),
  ]);
}

const errorEvent = (message: string): AskEvent => ({ type: "error", message });

/** Answers one question (spec §7.2). Yields step events as it works and ends with
 * exactly one answer or error event. */
export async function* ask(question: string, clock: () => number = Date.now): AsyncGenerator<AskEvent> {
  const start = clock();
  const messages: Message[] = [
    { role: "system", content: systemPrompt(new Date(start).toISOString().slice(0, 10)) },
    { role: "user", content: question },
  ];
  let mospiCalls = 0;
  let inputTokens = 0;
  let costUsd = 0;
  let turns = 0;
  let nudged = false;

  try {
    for (;;) {
      const elapsed = clock() - start;
      const remaining = HARD_DEADLINE_MS - elapsed;
      if (remaining < MIN_TURN_MS) {
        yield errorEvent("The question took too long to answer. Try a narrower question.");
        return;
      }
      const forced = mospiCalls >= MAX_MOSPI_CALLS || inputTokens >= INPUT_BUDGET || elapsed >= SOFT_DEADLINE_MS;

      let reply;
      try {
        reply = await chat(messages, forced, Math.min(TURN_TIMEOUT_MS, remaining));
      } catch (err) {
        yield errorEvent(`The assistant is not responding: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      turns++;
      inputTokens += reply.promptTokens;
      costUsd += reply.costUsd;

      const calls = reply.message.tool_calls ?? [];
      if (calls.length === 0) {
        if (nudged) {
          yield errorEvent("The assistant did not give an answer.");
          return;
        }
        nudged = true;
        messages.push(
          // Anthropic rejects an empty assistant message.
          { role: "assistant", content: reply.message.content || "(no tool call)" },
          { role: "user", content: "Call the answer tool now with your answer." },
        );
        continue;
      }
      messages.push({ role: "assistant", content: reply.message.content ?? null, tool_calls: calls });

      const answerCall = calls.find((c) => c.function.name === "answer");
      if (answerCall) {
        const parsed = answerArgsSchema.safeParse(parseArgs(answerCall.function.arguments));
        if (!parsed.success) {
          yield errorEvent("The assistant's answer could not be read.");
          return;
        }
        const { text, chart } = parsed.data;
        if (!chart) {
          yield { type: "answer", text, chart: null, pinnable: false, query: null };
          return;
        }
        // limit and page are fetchSeries' to set.
        const { limit: _limit, page: _page, ...filters } = chart.filters;
        void _limit;
        void _page;
        const query: ChartQuery = { ...chart, filters };
        yield { type: "step", label: "Drawing the chart…" };
        let points: Point[] | null = null;
        try {
          points = await withTimeout(
            fetchSeries({ id: "chart", label: query.title, ...query }),
            HARD_DEADLINE_MS - (clock() - start),
          );
        } catch (err) {
          // Several series, no rows, or out of time: the text answer still stands.
          console.warn("news-desk: chart query gave no series", err);
        }
        yield points
          ? { type: "answer", text, chart: { title: query.title, unit: query.unit, points }, pinnable: true, query }
          : { type: "answer", text, chart: null, pinnable: false, query: null };
        return;
      }

      for (const call of calls) {
        const name = call.function.name;
        const args = parseArgs(call.function.arguments);
        let content: string;
        if (!isMospiTool(name)) {
          content = `There is no tool called ${name}.`;
        } else if (!args) {
          content = "The arguments were not valid JSON.";
        } else if (mospiCalls >= MAX_MOSPI_CALLS) {
          content = "The tool-call limit is reached. Call answer with what you have.";
        } else {
          delete args.user_query;
          mospiCalls++;
          yield { type: "step", label: stepLabel(name, args) };
          try {
            const result = await callTool(name, args);
            content = capResult(name === "get_metadata" ? compactMetadata(result) : JSON.stringify(result));
          } catch (err) {
            if (err instanceof MospiUnavailableError) {
              yield errorEvent(`MoSPI is not responding: ${err.message}`);
              return;
            }
            if (!(err instanceof MospiError)) throw err;
            // A bad filter or a wrong type: the model can correct it.
            content = `MoSPI rejected this call: ${err.message}`;
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
  } finally {
    console.log(
      `news-desk: question took ${turns} turns, ${mospiCalls} MoSPI calls, ` +
        `${inputTokens} input tokens, ${((clock() - start) / 1000).toFixed(1)} s, $${costUsd.toFixed(4)}`,
    );
  }
}

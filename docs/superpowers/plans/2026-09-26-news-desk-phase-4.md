# News Desk Phase 4 (Chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Ask MoSPI" chat panel to News Desk that answers statistics questions from MoSPI data, charts a time series when the answer has one, and can pin that series into the indicator table.

**Architecture:** `ask.ts` is an async generator that runs an OpenRouter tool-calling loop over the four MoSPI tools plus an `answer` tool, yielding `step`, `answer` and `error` events. The `ask` route streams those events as NDJSON. When the answer names a chart query, the server re-runs it with `fetchSeries` from Phase 3, so chart numbers never come from the model. Pinning stores the query in `indicators.json`, which from this phase holds only pins; the effective list is the defaults plus the pins.

**Tech Stack:** Next.js 16 route handlers (streaming `Response`), React 19, TypeScript, zod 4, Vitest, Playwright, Storybook. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-news-desk-design.md` (§4, §7, §8, §9, §10, §12, §13). Epic #253. Also closes #268 and #269.

## Global Constraints

- Model: `process.env.NEWS_DESK_MODEL` via `OPENROUTER_BASE_URL`/`OPENROUTER_API_KEY`, as `tagger.ts` does. When any of the three is unset (local dev, Playwright, CI) the ask route answers 503 without calling out.
- Each question is sent on its own; nothing earlier is included (spec §7.1, D4). Input placeholder: "Each question is answered on its own."
- Limits (spec §7.2): 8 MoSPI tool calls, 1,500 output tokens per turn, about 120,000 input tokens across the loop. Past a limit the next request sets `tool_choice` to the `answer` function.
- Time (this plan, from `maxDuration = 60`): past 30 s the next turn is forced to answer; past 55 s, or with under 3 s left, the loop ends with an error event. Each OpenRouter call times out at `min(15 s, time left)`.
- A tool result goes back to the model at most 24,000 characters, with a truncation note. `get_metadata` results are compacted first (spec §7.2 step 3).
- The model never supplies chart numbers: `fetchSeries` re-runs the chart query on the server.
- `indicators.json` holds only pinned definitions from this phase on. The indicator list is `DEFAULT_INDICATORS` followed by the stored pins. Pin ids are `pin-` plus 12 hex characters of a SHA-256 of the query, so a pin cannot take a default's id (#269) and the same chart cannot be pinned twice.
- A pin or unpin refuses to write when `indicators.json` exists but cannot be read (spec §6.3).
- Lib tests start with `// @vitest-environment node`. Fixtures are read with `readFileSync(join(__dirname, "__fixtures__", …))`.
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`. Plain prose in docs, comments, UI copy and commit messages.

### What probing on 2026-09-26 found

| Finding | Consequence |
|---|---|
| `tools/list` returns full JSON schemas for all four tools (about 7,500 characters together); `get_indicators` and `get_metadata`'s schemas have a `user_query` parameter "captured for telemetry" | The tool definitions come from a recorded copy of `tools/list`, with `user_query` removed so the owner's question is not sent to MoSPI's telemetry |
| `get_metadata` for CPI base 2024 is 82,158 characters whether or not `level` is given; IIP 7,634; PLFS 10,872; NAS 3,676. PLFS nests its lists under `filter_values.data`, CPI under `data[0]`, IIP under `data` | Compaction walks the whole object and rewrites every array of flat objects, rather than assuming one shape. CPI compacts to 22,331 characters with every code and label kept, so the cap is 24,000 rather than the spec's 20,000 |
| MoSPI answers a wrong-typed argument with a plain-text pydantic error (`1 validation error for call[get_metadata] …`) | A rejected call goes back to the model as the tool result so it can correct itself; only an unreachable MoSPI ends the stream |
| Haiku 4.5 on OpenRouter honours `tool_choice: {type: "function", function: {name: "answer"}}`, and returns `usage.cost` | Forcing works as spec §7.2 step 5 assumes |
| With `tool_choice: "auto"` Haiku sent text and a tool call in the same message | A message with tool calls is followed whatever its text says; only a message with no tool calls counts as a plain reply |
| `list_datasets` returns 19,919 characters | Fits the cap untouched |

### Deviations from the spec, each recorded in Task 8's spec edit

- Truncation cap 24,000 characters, not 20,000 (above).
- A rejected MoSPI call is returned to the model; spec §12's "MoSPI down → error event" applies only when MoSPI cannot be reached (`MospiUnavailableError`, new in Task 2).
- A soft 30 s and hard 55 s deadline, which the spec does not have.
- `answer.chart` has an optional `match`, the Phase 3 row matcher, so a CPI division chart can be pinned.
- `indicators.json` holds pins only. Stored defaults would freeze them: a rebased default updated in code (spec §6.2) would never reach a list that had been written with the old one.
- Pin and unpin also update the saved snapshot, so the table shows a new pin (with dashes until the next Refresh) and drops an unpinned row without a Refresh. The spec says the row fills on the next Refresh, which still holds.
- Default indicators cannot be removed; only pins get a remove control (spec §4 says "pinned rows appear here with a remove control").
- `series.ts` no longer places a month inside a `YYYY-YY` year (#268). None of the recorded data uses that shape, and a dataset whose `YYYY-YY` is not April to March would be labelled a year off. Such rows are now unplaceable, so the chart is dropped and the answer is not pinnable.

## Review Focus

1. **A slow or wandering model.** Expect an answer or an error inside the route's 60 s, never a stream cut off by Vercel. Pinned in Task 4 (soft deadline forces `answer`; hard deadline ends with an error).
2. **A chart query that returns several series, or none** (a CPI division without `match`, a wrong `valueField`). Expect the text answer without a chart, and no Pin button. Pinned in Task 4 (`fetchSeries` rejects → `chart: null`, `pinnable: false`).
3. **Pinning when `indicators.json` cannot be read, or pinning the same chart twice.** Expect nothing written and a clear message; a duplicate gets 409. Pinned in Task 6.
4. **The stream stops early** (network drop, function killed). Expect the steps already shown to stay, with "The answer did not arrive." Pinned in Task 7.
5. **A question that tries to steer the model** ("ignore your instructions…") or an answer containing markup. Expect the model to have only MoSPI's read-only tools, and the answer shown as plain text. Pinned in Task 7 (answer text with `<b>` renders literally).

---

### Task 0: Issue and branch

No code.

- [ ] **Step 1: File the Phase 4 issue**

```bash
cd /e/Personal/looper && gh issue create \
  --title "News Desk Phase 4: Ask MoSPI chat and pinning" \
  --label "enhancement" --label "priority: medium" --label "area: finance" \
  --body "$(cat <<'EOF'
## Summary

Add an "Ask MoSPI" chat panel to News Desk. It answers a statistics question from MoSPI data, draws a chart when the answer is a time series, and can pin that series into the indicator table. Pinned rows can be removed.

Part of #253. Spec: `docs/superpowers/specs/2026-09-25-news-desk-design.md` §7. Plan: `docs/superpowers/plans/2026-09-26-news-desk-phase-4.md`. Also settles #268 (fiscal-year months) and #269 (pin ids).

## Done when

- A question streams its steps and ends in an answer or an error within 60 s.
- A chart is drawn from numbers the server fetched, never from the model.
- Pinning adds the series to the table; removing a pin takes it out; defaults cannot be removed.
- The cost of a question is measured and recorded in spec §10.
EOF
)"
```

Note the number as `<N>`. In epic #253's body, change `- [ ] **Phase 4: Chat assistant.**` to `- [ ] #<N> **Phase 4: Chat assistant.**` (`gh issue view 253 --json body -q .body > body.md`, edit, `gh issue edit 253 --body-file body.md`).

- [ ] **Step 2: Branch off `dev` and commit the plan**

The fixtures recorded during planning (`metadata-cpi-2024.json`, `metadata-iip.json`, `metadata-plfs.json`, `metadata-nas.json`, `tools-list.json`) are untracked in `web/lib/news-desk/__fixtures__/mospi/`; they carry over and are committed in Tasks 2 and 3.

```bash
cd /e/Personal/looper && git switch dev && git pull --ff-only && git switch -c feat/news-desk-phase-4
git add docs/superpowers/plans/2026-09-26-news-desk-phase-4.md
git commit -m "docs: News Desk Phase 4 plan

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 1: Stop placing months inside a fiscal-year label (#268)

**Files:**
- Modify: `web/lib/news-desk/series.ts`, `web/lib/news-desk/series.test.ts`

**Interfaces:**
- Produces: `toSeries` unchanged in signature; a row with a `YYYY-YY` year and a month is now unplaceable.

- [ ] **Step 1: Change the test**

In `web/lib/news-desk/series.test.ts`, replace the test `"places a month in a fiscal year: April–December in the first year, January–March in the second"` with:

```ts
  it("does not place a month inside a fiscal-year label, whose calendar year depends on the dataset", () => {
    // An April–March year and a July–June year both read "2025-26"; guessing
    // would label every point of the wrong kind a year off (#268).
    const result = toSeries([{ year: "2025-26", month: "March", growth_rate: "5.0" }], "growth_rate");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/cannot place a row in time/) });
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/series.test.ts`
Expected: FAIL — the row is placed as "Mar 2026".

- [ ] **Step 3: Remove the branch**

In `web/lib/news-desk/series.ts`, delete:

```ts
  if (fiscal && month >= 0) {
    // India's fiscal year runs April to March.
    const calendarYear = Number(fiscal[1]) + (month < 3 ? 1 : 0);
    return { key: calendarYear * 12 + month, label: `${SHORT[month]} ${calendarYear}` };
  }
```

Directly above the `if (fiscal && quarter)` branch add:

```ts
  // A month inside a fiscal-year label is not placed: "2025-26" is April–March
  // for NAS but July–June for other surveys, and nothing in the row says which.
```

- [ ] **Step 4: Run the tests**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk`
Expected: PASS. The Phase 3 default-indicator tests still pass, since no recorded response uses a month inside a fiscal year.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/series.ts web/lib/news-desk/series.test.ts
git commit -m "fix(news-desk): do not guess the calendar year of a month in a fiscal-year label

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: Unreachable-MoSPI error and metadata compaction

**Files:**
- Modify: `web/lib/news-desk/mospi.ts`, `web/lib/news-desk/mospi.test.ts`
- Create: `web/lib/news-desk/compact.ts`, `web/lib/news-desk/compact.test.ts`
- Commit: `web/lib/news-desk/__fixtures__/mospi/metadata-*.json`

**Interfaces:**
- Produces: `class MospiUnavailableError extends MospiError` — thrown for an HTTP error status, a timeout or a network failure. A rejected query still throws plain `MospiError`. `compactMetadata(json: unknown): string`; `capResult(text: string): string`; `MAX_RESULT_CHARS = 24_000`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` in `web/lib/news-desk/mospi.test.ts` (add `MospiUnavailableError` to the `./mospi` import):

```ts
  it("marks an HTTP error status as MoSPI being unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    await expect(callTool("get_data", {})).rejects.toBeInstanceOf(MospiUnavailableError);
  });

  it("marks a network failure as MoSPI being unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(callTool("get_data", {})).rejects.toThrow("MoSPI could not be reached: fetch failed");
    await expect(callTool("get_data", {})).rejects.toBeInstanceOf(MospiUnavailableError);
  });

  it("does not mark a rejected query as MoSPI being unreachable", async () => {
    const body = JSON.stringify({ error: "Invalid parameters", valid: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(toolText(body))));
    const err = await callTool("get_data", {}).catch((e) => e);
    expect(err).toBeInstanceOf(MospiError);
    expect(err).not.toBeInstanceOf(MospiUnavailableError);
  });
```

In the existing `"gives up after 10 s with a readable error"` test, add after its `toBeInstanceOf(MospiError)` line:

```ts
    await expect(call).rejects.toBeInstanceOf(MospiUnavailableError);
```

`web/lib/news-desk/compact.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capResult, compactMetadata, MAX_RESULT_CHARS } from "./compact";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "mospi", name), "utf8"));

describe("compactMetadata", () => {
  it("shrinks CPI base 2024 below the cap and keeps every item's code and label", () => {
    const raw = fixture("metadata-cpi-2024.json");
    const text = compactMetadata(raw);
    expect(text.length).toBeLessThan(MAX_RESULT_CHARS);
    expect(text.length).toBeLessThan(JSON.stringify(raw).length / 3);
    const items = raw.data[0].item as { item_code: number; item_name: string }[];
    expect(items).toHaveLength(358);
    for (const { item_code, item_name } of items) expect(text).toContain(`${item_code}=${item_name}`);
    expect(text).toContain("division: 0=CPI (General); 1=Food and beverages");
    expect(text).not.toContain("viz");
  });

  it("lists the get_data parameters with their allowed values and notes", () => {
    const text = compactMetadata(fixture("metadata-cpi-2024.json"));
    expect(text).toContain("get_data filters:");
    expect(text).toContain("- base_year (required) one of 2012/2010/2024");
  });

  it("finds lists nested under filter_values, as PLFS returns them", () => {
    const text = compactMetadata(fixture("metadata-plfs.json"));
    expect(text).toContain("gender: 1=male; 2=female; 3=person");
    expect(text).toContain("sector: 1=rural; 2=urban; 3=rural + urban");
  });

  it("keeps a list without codes as plain values", () => {
    const text = compactMetadata(fixture("metadata-iip.json"));
    expect(text).toContain("type: General; Sectoral; Use-based category");
  });
});

describe("capResult", () => {
  it("leaves a short result alone", () => {
    expect(capResult("abc")).toBe("abc");
  });

  it("cuts a long result at the cap and says so", () => {
    const text = capResult("x".repeat(MAX_RESULT_CHARS + 10));
    expect(text.startsWith("x".repeat(MAX_RESULT_CHARS))).toBe(true);
    expect(text).toContain("[Truncated at 24000 characters. Ask for a narrower level or fewer rows.]");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/mospi.test.ts lib/news-desk/compact.test.ts`
Expected: FAIL — `MospiUnavailableError` and `./compact` do not exist.

- [ ] **Step 3: Implement**

In `web/lib/news-desk/mospi.ts`, after `export class MospiError extends Error {}` add:

```ts
/** MoSPI could not be reached: an HTTP error status, a timeout or a network
 * failure. Unlike a rejected query, asking again differently will not help. */
export class MospiUnavailableError extends MospiError {}
```

Replace the `catch` around `fetch` and the status check:

```ts
  } catch (err) {
    if ((err as { name?: string }).name === "TimeoutError") {
      throw new MospiUnavailableError(`MoSPI did not answer within ${TIMEOUT_MS / 1000} s`);
    }
    throw new MospiUnavailableError(`MoSPI could not be reached: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new MospiUnavailableError(`MoSPI status ${res.status}`);
```

`web/lib/news-desk/compact.ts`:

```ts
// Tool results go back to the model on every later turn of a question, so their
// size is paid for again each time. See spec §7.2 step 3.
export const MAX_RESULT_CHARS = 24_000;

const SKIP = new Set(["viz", "msg", "statusCode"]);

type Flat = Record<string, string | number | boolean | null>;

function isFlat(v: unknown): v is Flat {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => x === null || typeof x !== "object")
  );
}

function entry(o: Flat): string {
  const keys = Object.keys(o).filter((k) => !SKIP.has(k));
  const code = keys.find((k) => k.endsWith("_code"));
  const label = keys.find((k) => k.endsWith("_name")) ?? keys.find((k) => k === "name" || k === "description");
  // Parent codes (a CPI item's class, group and division) are dropped: they
  // more than double CPI's size and the labels already say what an item is.
  if (code && label) return `${o[code]}=${o[label]}`;
  return keys.length === 1 ? String(o[keys[0]]) : keys.map((k) => `${k}=${o[k]}`).join(" ");
}

type Param = { name: string; required?: boolean; description?: string; schema?: { enum?: string[] } };

function param(p: Param): string {
  const allowed = p.schema?.enum ? ` one of ${p.schema.enum.join("/")}` : "";
  const note = p.description ? `: ${p.description.trim()}` : "";
  return `- ${p.name}${p.required ? " (required)" : ""}${allowed}${note}`;
}

function walk(v: unknown, key: string, out: string[]): void {
  if (key === "api_params" && Array.isArray(v)) {
    out.push("get_data filters:", ...(v as Param[]).map(param));
    return;
  }
  if (Array.isArray(v) && v.length > 0 && v.every(isFlat)) {
    out.push(`${key}: ${v.map(entry).join("; ")}`);
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (!SKIP.has(k)) walk(x, Array.isArray(v) ? key : k, out);
    }
    return;
  }
  out.push(`${key}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
}

/** Rewrites a get_metadata result as one line per filter list,
 * `name: code=label; code=label`, keeping every value. MoSPI nests the lists
 * differently per dataset (CPI under data[0], PLFS under filter_values.data),
 * so the whole object is walked. */
export function compactMetadata(json: unknown): string {
  const out: string[] = [];
  walk(json, "", out);
  return out.join("\n");
}

export function capResult(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[Truncated at ${MAX_RESULT_CHARS} characters. Ask for a narrower level or fewer rows.]`;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk`
Expected: PASS. The Phase 3 `indicators.test.ts` tests still pass (`MospiUnavailableError` is a `MospiError`).

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/mospi.ts web/lib/news-desk/mospi.test.ts web/lib/news-desk/compact.ts web/lib/news-desk/compact.test.ts web/lib/news-desk/__fixtures__/mospi/metadata-*.json
git commit -m "feat(news-desk): tell an unreachable MoSPI from a rejected query; compact metadata

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: Tool definitions and chat event types

**Files:**
- Create: `web/lib/news-desk/mospi-tools.json` (copied from the fixture), `web/lib/news-desk/mospi-tools.ts`, `web/lib/news-desk/mospi-tools.test.ts`, `web/lib/news-desk/chat-types.ts`
- Commit: `web/lib/news-desk/__fixtures__/mospi/tools-list.json`

**Interfaces:**
- Produces (in `mospi-tools.ts`): `MOSPI_TOOLS = ["list_datasets", "get_indicators", "get_metadata", "get_data"] as const`; `isMospiTool(name: string): name is MospiTool`; `mospiToolDefinitions(): ToolDefinition[]`; `ANSWER_TOOL: ToolDefinition`; `answerArgsSchema` (zod) parsing `{text: string, chart: null | ChartQuery}`; `stepLabel(name: MospiTool, args: Record<string, unknown>): string`; `type ToolDefinition = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }`.
- Produces (in `chat-types.ts`, no zod, no Node imports, safe for client components): `type ChartQuery = { title: string; unit: string; dataset: string; filters: Record<string, string>; valueField: string; match?: Record<string, string> }`; `type AnswerEvent = { type: "answer"; text: string; chart: { title: string; unit: string; points: Point[] } | null; pinnable: boolean; query: ChartQuery | null }`; `type AskEvent = { type: "step"; label: string } | AnswerEvent | { type: "error"; message: string }`; `PIN_PREFIX = "pin-"`; `isPinId(id: string): boolean`.

- [ ] **Step 1: Copy the recorded tool list**

```bash
cd /e/Personal/looper/web && cp lib/news-desk/__fixtures__/mospi/tools-list.json lib/news-desk/mospi-tools.json
```

The file is MoSPI's `tools/list` result recorded on 2026-09-26: `{"tools": [{name, description, inputSchema}, …]}`.

- [ ] **Step 2: Write the failing tests**

`web/lib/news-desk/mospi-tools.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ANSWER_TOOL, answerArgsSchema, isMospiTool, mospiToolDefinitions, stepLabel } from "./mospi-tools";

describe("mospiToolDefinitions", () => {
  it("offers the four MoSPI tools as OpenRouter functions", () => {
    const defs = mospiToolDefinitions();
    expect(defs.map((d) => d.function.name).sort()).toEqual(["get_data", "get_indicators", "get_metadata", "list_datasets"]);
    const getData = defs.find((d) => d.function.name === "get_data")!;
    expect(getData.type).toBe("function");
    expect(getData.function.parameters).toMatchObject({ required: ["dataset", "filters"] });
  });

  it("does not offer MoSPI's telemetry parameter for the owner's question", () => {
    expect(JSON.stringify(mospiToolDefinitions())).not.toContain("user_query");
  });
});

describe("ANSWER_TOOL", () => {
  it("requires text and a chart that may be null", () => {
    expect(ANSWER_TOOL.function.name).toBe("answer");
    expect(ANSWER_TOOL.function.parameters).toMatchObject({ required: ["text", "chart"] });
  });
});

describe("answerArgsSchema", () => {
  it("accepts a chart query and turns numeric filter values into strings", () => {
    const parsed = answerArgsSchema.parse({
      text: "Retail inflation was 4.82% in August 2026.",
      chart: { title: "Retail inflation", unit: "%", dataset: "CPI", filters: { base_year: "2024", state_code: 1 }, valueField: "inflation" },
    });
    expect(parsed.chart?.filters).toEqual({ base_year: "2024", state_code: "1" });
  });

  it("accepts no chart", () => {
    expect(answerArgsSchema.parse({ text: "No data.", chart: null }).chart).toBeNull();
  });
});

describe("stepLabel", () => {
  it("names the dataset for each MoSPI tool", () => {
    expect(stepLabel("list_datasets", {})).toBe("Looking through MoSPI's datasets…");
    expect(stepLabel("get_indicators", { dataset: "IIP" })).toBe("Reading IIP indicators…");
    expect(stepLabel("get_metadata", { dataset: "CPI" })).toBe("Reading CPI filters…");
    expect(stepLabel("get_data", { dataset: "PLFS" })).toBe("Fetching PLFS data…");
  });

  it("recognises only MoSPI's tools", () => {
    expect(isMospiTool("get_data")).toBe(true);
    expect(isMospiTool("answer")).toBe(false);
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/mospi-tools.test.ts`
Expected: FAIL — `./mospi-tools` does not exist.

- [ ] **Step 4: Implement**

`web/lib/news-desk/chat-types.ts`:

```ts
// Shared by the ask route and the chat panel. No zod and no Node imports, so a
// client component can import it.
import type { Point } from "./series";

export type ChartQuery = {
  title: string;
  unit: string;
  dataset: string;
  filters: Record<string, string>;
  valueField: string;
  match?: Record<string, string>;
};

export type AnswerEvent = {
  type: "answer";
  text: string;
  chart: { title: string; unit: string; points: Point[] } | null;
  // True when the server re-ran the chart query and got a valid series (spec §7.3).
  pinnable: boolean;
  query: ChartQuery | null;
};

export type AskEvent = { type: "step"; label: string } | AnswerEvent | { type: "error"; message: string };

// Pinned indicators have ids of this form; defaults never do (#269).
export const PIN_PREFIX = "pin-";

export function isPinId(id: string): boolean {
  return id.startsWith(PIN_PREFIX);
}
```

`web/lib/news-desk/mospi-tools.ts`:

```ts
import { z } from "zod";
import recorded from "./mospi-tools.json";

// MoSPI's own tool schemas, recorded from tools/list on 2026-09-26. Recorded
// rather than fetched per question: one call fewer, and a schema change shows up
// as MoSPI rejecting a call, which goes back to the model to correct.
export const MOSPI_TOOLS = ["list_datasets", "get_indicators", "get_metadata", "get_data"] as const;
export type MospiTool = (typeof MOSPI_TOOLS)[number];

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type RecordedTool = {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, unknown> } & Record<string, unknown>;
};

export function isMospiTool(name: string): name is MospiTool {
  return (MOSPI_TOOLS as readonly string[]).includes(name);
}

export function mospiToolDefinitions(): ToolDefinition[] {
  return (recorded as unknown as { tools: RecordedTool[] }).tools
    .filter((t) => isMospiTool(t.name))
    .map((t) => {
      // user_query asks for the user's question verbatim "for telemetry". The
      // owner's questions are not MoSPI's to collect.
      const { user_query: _dropped, ...properties } = t.inputSchema.properties ?? {};
      void _dropped;
      return {
        type: "function",
        function: { name: t.name, description: t.description, parameters: { ...t.inputSchema, properties } },
      };
    });
}

const stringMap = { type: "object", additionalProperties: { type: "string" } };

export const ANSWER_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "answer",
    description:
      "Give your final answer. Call this once, when you are done or cannot find the data. " +
      "text: a short plain answer that states only numbers from tool results, with their period and base year. " +
      "chart: when the answer is a time series from one get_data query, that query, so the server can re-run it and draw it; otherwise null. " +
      "Put in filters exactly what you passed to get_data, without limit and page. " +
      'If that query returns several series (a CPI division also returns its groups and classes), set match to row fields that pick one, such as {"code": "01"}.',
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["text", "chart"],
      properties: {
        text: { type: "string" },
        chart: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["title", "unit", "dataset", "filters", "valueField"],
              properties: {
                title: { type: "string", description: 'Short title, e.g. "Retail inflation, All India"' },
                unit: { type: "string", description: '"%" for rates; otherwise a short unit, or ""' },
                dataset: { type: "string" },
                filters: stringMap,
                valueField: { type: "string", description: "The row field holding the number, e.g. inflation, growth_rate, value" },
                match: stringMap,
              },
            },
          ],
        },
      },
    },
  },
};

// The model sometimes sends a code as a number; MoSPI filters are strings.
const stringRecord = z.record(z.string(), z.coerce.string());

export const answerArgsSchema = z.object({
  text: z.string().min(1),
  chart: z
    .object({
      title: z.string().min(1),
      unit: z.string(),
      dataset: z.string().min(1),
      filters: stringRecord,
      valueField: z.string().min(1),
      match: stringRecord.optional(),
    })
    .nullable(),
});

export function stepLabel(name: MospiTool, args: Record<string, unknown>): string {
  const dataset = typeof args.dataset === "string" ? args.dataset : "MoSPI";
  switch (name) {
    case "list_datasets":
      return "Looking through MoSPI's datasets…";
    case "get_indicators":
      return `Reading ${dataset} indicators…`;
    case "get_metadata":
      return `Reading ${dataset} filters…`;
    case "get_data":
      return `Fetching ${dataset} data…`;
  }
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/mospi-tools.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/mospi-tools.json web/lib/news-desk/mospi-tools.ts web/lib/news-desk/mospi-tools.test.ts web/lib/news-desk/chat-types.ts web/lib/news-desk/__fixtures__/mospi/tools-list.json
git commit -m "feat(news-desk): MoSPI tool definitions, answer tool and chat event types

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: The ask loop

**Files:**
- Create: `web/lib/news-desk/ask.ts`, `web/lib/news-desk/ask.test.ts`

**Interfaces:**
- Consumes: `callTool`, `MospiError`, `MospiUnavailableError` (Task 2); `compactMetadata`, `capResult` (Task 2); `mospiToolDefinitions`, `ANSWER_TOOL`, `answerArgsSchema`, `isMospiTool`, `stepLabel` (Task 3); `AskEvent`, `ChartQuery` (Task 3); `fetchSeries(def: IndicatorDef): Promise<Point[]>` (Phase 3).
- Produces: `isAskConfigured(): boolean`; `ask(question: string, clock?: () => number): AsyncGenerator<AskEvent>`. The generator never throws for MoSPI or OpenRouter failures; it yields one `error` event and returns.

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/ask.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/ask.test.ts`
Expected: FAIL — `./ask` does not exist.

- [ ] **Step 3: Implement `web/lib/news-desk/ask.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests, lint and type check**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk && npx eslint lib/news-desk && npx tsc --noEmit`
Expected: PASS (14 new tests), no lint or type errors.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/ask.ts web/lib/news-desk/ask.test.ts
git commit -m "feat(news-desk): answer a question with an OpenRouter tool loop over MoSPI

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: The ask route

**Files:**
- Create: `web/app/api/news-desk/ask/route.ts`, `web/app/api/news-desk/ask/route.test.ts`
- Modify: `web/e2e/news-desk.spec.ts`

**Interfaces:**
- Consumes: `ask`, `isAskConfigured` (Task 4).
- Produces: `POST /api/news-desk/ask` with `{question}` → `application/x-ndjson`, one `AskEvent` per line. 400 `{error}` for a question that is empty or over 500 characters; 503 `{error: "assistant not configured"}`. `maxDuration = 60`.

- [ ] **Step 1: Write the failing tests**

`web/app/api/news-desk/ask/route.test.ts`:

```ts
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
```

Append to `web/e2e/news-desk.spec.ts`:

```ts
test("the ask and pin routes are behind the gate", async ({ request }) => {
  for (const [method, url] of [
    ["post", "/api/news-desk/ask"],
    ["post", "/api/news-desk/indicators"],
    ["delete", "/api/news-desk/indicators/pin-000000000000"],
  ] as const) {
    const res = await request[method](url, { maxRedirects: 0 });
    expect(res.status(), `${method} ${url}`).toBe(401);
  }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run app/api/news-desk/ask`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement `web/app/api/news-desk/ask/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { ask, isAskConfigured } from "@/lib/news-desk/ask";

// A question's tool loop ends itself before 55 s; see lib/news-desk/ask.ts.
export const maxDuration = 60;

const bodySchema = z.object({ question: z.string().trim().min(1).max(500) });

export async function POST(req: Request) {
  if (!isAskConfigured()) {
    return NextResponse.json({ error: "assistant not configured" }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "question must be 1 to 500 characters" }, { status: 400 });
  }

  const events = ask(parsed.data.question);
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  // Pulled one event at a time, so each step reaches the browser as it happens.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(line(value));
      } catch (err) {
        console.error("news-desk: ask failed", err);
        controller.enqueue(line({ type: "error", message: "The assistant failed unexpectedly." }));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /e/Personal/looper/web && npx vitest run app/api/news-desk && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/app/api/news-desk/ask web/e2e/news-desk.spec.ts
git commit -m "feat(news-desk): stream answers from the ask route as NDJSON

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: Pins stored apart from the defaults, and the pin routes

**Files:**
- Modify: `web/lib/news-desk/store.ts`, `web/lib/news-desk/store.test.ts`
- Create: `web/lib/news-desk/pins.ts`, `web/lib/news-desk/pins.test.ts`, `web/app/api/news-desk/indicators/route.ts`, `web/app/api/news-desk/indicators/route.test.ts`, `web/app/api/news-desk/indicators/[id]/route.ts`, `web/app/api/news-desk/indicators/[id]/route.test.ts`

**Interfaces:**
- Consumes: `isPinId`, `PIN_PREFIX` (Task 3); `IndicatorDef`, `IndicatorValue`, `indicatorDefSchema` (Phase 3).
- Produces (in `store.ts`): `readPins(): Promise<IndicatorDef[]>` (`[]` when the file is missing; throws otherwise); `writePins(pins: IndicatorDef[]): Promise<void>`; `readIndicatorDefs()` now returns `[...DEFAULT_INDICATORS, ...pins]`, skipping a stored entry whose id is a default's.
- Produces (in `pins.ts`): `pinInputSchema`, `type PinInput = { label; dataset; filters; valueField; unit; match? }`; `pinId(input): string`; `class PinError extends Error { status: number }`; `pinIndicator(input: PinInput): Promise<IndicatorValue>`; `unpinIndicator(id: string): Promise<void>`.
- Produces (routes): `POST /api/news-desk/indicators` → 201 `{indicator: IndicatorValue}`; `DELETE /api/news-desk/indicators/:id` → 200 `{ok: true}`. Errors: 400 invalid input or a default's id, 404 not pinned, 409 already pinned, 503 storage not configured, 500 `{error: "could not read or write the pinned indicators; nothing changed"}`.

- [ ] **Step 1: Write the failing tests**

In `web/lib/news-desk/store.test.ts`, add `readPins` and `writePins` to the `./store` import, and replace the test `"reads stored indicator definitions"` with:

```ts
  it("lists the defaults, then the stored pins", async () => {
    const pin = { id: "pin-abc", label: "X", dataset: "IIP", filters: { type: "General" }, valueField: "growth_rate", unit: "%" };
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify([pin])));
    expect(await readIndicatorDefs()).toEqual([...DEFAULT_INDICATORS, pin]);
  });

  it("does not let a stored entry replace or repeat a default", async () => {
    const clash = { ...DEFAULT_INDICATORS[0], label: "Changed" };
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify([clash])));
    expect(await readIndicatorDefs()).toEqual(DEFAULT_INDICATORS);
  });

  it("reads no pins when none are stored", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
    expect(await readPins()).toEqual([]);
  });

  it("writes the pins as the whole indicators file", async () => {
    const pin = { id: "pin-abc", label: "X", dataset: "IIP", filters: {}, valueField: "growth_rate", unit: "%" };
    await writePins([pin]);
    expect(putObjectJson).toHaveBeenCalledWith("audio-bucket", INDICATORS_KEY, [pin]);
  });
```

`web/lib/news-desk/pins.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return { ...actual, readPins: vi.fn(), writePins: vi.fn(), readSnapshot: vi.fn(), writeSnapshot: vi.fn() };
});

import { PinError, pinId, pinIndicator, unpinIndicator } from "./pins";
import { readPins, readSnapshot, SnapshotCorruptError, writePins, writeSnapshot } from "./store";
import type { Snapshot } from "./types";

const INPUT = {
  label: "IIP manufacturing",
  dataset: "IIP",
  filters: { base_year: "2022-23", frequency: "Monthly", type: "Sectoral", category_code: "2" },
  valueField: "growth_rate",
  unit: "%",
};
const SNAPSHOT: Snapshot = { version: 1, refreshedAt: "2026-09-26T10:00:00.000Z", headlines: [], indicators: [], sourceErrors: [] };

describe("pinId", () => {
  it("is the same for the same query whatever the filter order", () => {
    const reordered = { ...INPUT, filters: Object.fromEntries(Object.entries(INPUT.filters).reverse()) };
    expect(pinId(INPUT)).toBe(pinId(reordered));
    expect(pinId(INPUT)).toMatch(/^pin-[0-9a-f]{12}$/);
  });

  it("differs when the query differs", () => {
    expect(pinId(INPUT)).not.toBe(pinId({ ...INPUT, valueField: "index" }));
  });
});

describe("pinIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPins).mockResolvedValue([]);
    vi.mocked(readSnapshot).mockResolvedValue(SNAPSHOT);
  });

  it("stores the pin and adds an empty row to the saved table", async () => {
    const row = await pinIndicator(INPUT);
    const id = pinId(INPUT);
    expect(writePins).toHaveBeenCalledWith([{ id, ...INPUT }]);
    expect(row).toEqual({ id, label: INPUT.label, unit: "%", period: null, latest: null, prevPeriod: null, prev: null, lastGoodAt: null });
    expect(writeSnapshot).toHaveBeenCalledWith({ ...SNAPSHOT, indicators: [row] });
  });

  it("refuses the same chart twice", async () => {
    vi.mocked(readPins).mockResolvedValue([{ id: pinId(INPUT), ...INPUT }]);
    await expect(pinIndicator(INPUT)).rejects.toEqual(new PinError("already pinned", 409));
    expect(writePins).not.toHaveBeenCalled();
  });

  it("writes nothing when the stored pins cannot be read", async () => {
    vi.mocked(readPins).mockRejectedValue(new Error("Access Denied"));
    await expect(pinIndicator(INPUT)).rejects.toThrow("Access Denied");
    expect(writePins).not.toHaveBeenCalled();
    expect(writeSnapshot).not.toHaveBeenCalled();
  });

  it("stores the pin even when there is no usable snapshot yet", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(new SnapshotCorruptError("bad"));
    await pinIndicator(INPUT);
    expect(writePins).toHaveBeenCalled();
    expect(writeSnapshot).not.toHaveBeenCalled();
  });
});

describe("unpinIndicator", () => {
  const id = pinId(INPUT);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPins).mockResolvedValue([{ id, ...INPUT }]);
    vi.mocked(readSnapshot).mockResolvedValue({
      ...SNAPSHOT,
      indicators: [{ id, label: "IIP manufacturing", unit: "%", period: null, latest: null, prevPeriod: null, prev: null, lastGoodAt: null }],
    });
  });

  it("removes the pin and its row", async () => {
    await unpinIndicator(id);
    expect(writePins).toHaveBeenCalledWith([]);
    expect(writeSnapshot).toHaveBeenCalledWith(SNAPSHOT);
  });

  it("refuses to remove a default indicator", async () => {
    await expect(unpinIndicator("cpi-headline")).rejects.toEqual(new PinError("default indicators cannot be removed", 400));
  });

  it("says when the id is not pinned", async () => {
    await expect(unpinIndicator("pin-000000000000")).rejects.toEqual(new PinError("not pinned", 404));
  });
});
```

`web/app/api/news-desk/indicators/route.test.ts`:

```ts
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
```

`web/app/api/news-desk/indicators/[id]/route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/store.test.ts lib/news-desk/pins.test.ts app/api/news-desk/indicators`
Expected: FAIL — `readPins`, `writePins`, `./pins` and the routes do not exist; `readIndicatorDefs` returns the stored list without the defaults.

- [ ] **Step 3: Implement**

In `web/lib/news-desk/store.ts`, replace `readIndicatorDefs` with:

```ts
/** The pinned indicator definitions. `indicators.json` holds only pins: stored
 * defaults would never pick up a change to DEFAULT_INDICATORS (spec §6.2). */
export async function readPins(): Promise<IndicatorDef[]> {
  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(bucket(), INDICATORS_KEY);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return [];
    throw err;
  }
  return z.array(indicatorDefSchema).parse(JSON.parse(bytes.toString("utf8")));
}

export async function writePins(pins: IndicatorDef[]): Promise<void> {
  await putObjectJson(bucket(), INDICATORS_KEY, pins);
}

/** The defaults, then the pins. */
export async function readIndicatorDefs(): Promise<IndicatorDef[]> {
  const defaultIds = new Set(DEFAULT_INDICATORS.map((d) => d.id));
  const pins = await readPins();
  return [...DEFAULT_INDICATORS, ...pins.filter((p) => !defaultIds.has(p.id))];
}
```

`web/lib/news-desk/pins.ts`:

```ts
import { createHash } from "node:crypto";
import { z } from "zod";
import { isPinId, PIN_PREFIX } from "./chat-types";
import { readPins, readSnapshot, SnapshotCorruptError, writePins, writeSnapshot } from "./store";
import type { IndicatorDef, IndicatorValue } from "./types";

const text = z.string().trim().min(1).max(100);
const fields = z.record(text, text).refine((r) => Object.keys(r).length <= 30, "too many fields");

export const pinInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  dataset: text,
  filters: fields,
  valueField: text,
  unit: z.string().max(20),
  match: fields.optional(),
});
export type PinInput = z.infer<typeof pinInputSchema>;

export class PinError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sorted = (r: Record<string, string> | undefined) =>
  r ? Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))) : null;

/** Derived from the query, so the same chart cannot be pinned twice, and
 * prefixed so a pin cannot take a default's id (#269). */
export function pinId(q: Pick<PinInput, "dataset" | "filters" | "valueField" | "match">): string {
  const key = JSON.stringify([q.dataset, sorted(q.filters), q.valueField, sorted(q.match)]);
  return `${PIN_PREFIX}${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

/** Keeps the saved table in step without a Refresh. Skipped when nothing is
 * saved yet or the snapshot is corrupt: the next Refresh writes a whole one. */
async function updateSnapshot(change: (rows: IndicatorValue[]) => IndicatorValue[]): Promise<void> {
  let snapshot;
  try {
    snapshot = await readSnapshot();
  } catch (err) {
    if (err instanceof SnapshotCorruptError) return;
    throw err;
  }
  if (!snapshot) return;
  await writeSnapshot({ ...snapshot, indicators: change(snapshot.indicators) });
}

export async function pinIndicator(input: PinInput): Promise<IndicatorValue> {
  // readPins throws when the file exists but cannot be read. Writing anyway
  // would replace the owner's pins with this one (spec §6.3).
  const pins = await readPins();
  const id = pinId(input);
  if (pins.some((p) => p.id === id)) throw new PinError("already pinned", 409);
  const def: IndicatorDef = { id, ...input };
  await writePins([...pins, def]);
  // Filled on the next Refresh (spec §7.3).
  const row: IndicatorValue = { id, label: def.label, unit: def.unit, period: null, latest: null, prevPeriod: null, prev: null, lastGoodAt: null };
  await updateSnapshot((rows) => [...rows.filter((r) => r.id !== id), row]);
  return row;
}

export async function unpinIndicator(id: string): Promise<void> {
  if (!isPinId(id)) throw new PinError("default indicators cannot be removed", 400);
  const pins = await readPins();
  if (!pins.some((p) => p.id === id)) throw new PinError("not pinned", 404);
  await writePins(pins.filter((p) => p.id !== id));
  await updateSnapshot((rows) => rows.filter((r) => r.id !== id));
}
```

`web/app/api/news-desk/indicators/route.ts`:

```ts
import { NextResponse } from "next/server";
import { PinError, pinIndicator, pinInputSchema } from "@/lib/news-desk/pins";
import { isStorageConfigured } from "@/lib/news-desk/store";

export async function POST(req: Request) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }
  const parsed = pinInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid pin" }, { status: 400 });
  try {
    return NextResponse.json({ indicator: await pinIndicator(parsed.data) }, { status: 201 });
  } catch (err) {
    if (err instanceof PinError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("news-desk: pin failed", err);
    return NextResponse.json(
      { error: "could not read or write the pinned indicators; nothing changed" },
      { status: 500 },
    );
  }
}
```

`web/app/api/news-desk/indicators/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { PinError, unpinIndicator } from "@/lib/news-desk/pins";
import { isStorageConfigured } from "@/lib/news-desk/store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }
  const { id } = await params;
  try {
    await unpinIndicator(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PinError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("news-desk: unpin failed", err);
    return NextResponse.json(
      { error: "could not read or write the pinned indicators; nothing changed" },
      { status: 500 },
    );
  }
}
```

The 500 message says "nothing changed", which is true when the read or the first write fails. If `writePins` succeeds and the snapshot write fails, the pin is stored and the table catches up on the next Refresh; the message then overstates. That window is two S3 calls wide and is accepted.

- [ ] **Step 4: Run the tests and the type check**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk app/api/news-desk && npx tsc --noEmit`
Expected: PASS. The Phase 3 refresh tests still pass: `readIndicatorDefs` is mocked there.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/store.ts web/lib/news-desk/store.test.ts web/lib/news-desk/pins.ts web/lib/news-desk/pins.test.ts web/app/api/news-desk/indicators
git commit -m "feat(news-desk): pin and unpin indicators, stored apart from the defaults

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 7: Chat panel, chart and remove control

**Files:**
- Create: `web/lib/news-desk/ndjson.ts`, `web/lib/news-desk/ndjson.test.ts`, `web/components/news-desk/LineChart.tsx`, `web/components/news-desk/LineChart.test.tsx`, `web/components/news-desk/LineChart.stories.tsx`, `web/components/news-desk/ChatPanel.tsx`, `web/components/news-desk/ChatPanel.test.tsx`, `web/components/news-desk/ChatPanel.stories.tsx`
- Modify: `web/components/news-desk/IndicatorTable.tsx`, `web/components/news-desk/IndicatorTable.test.tsx`, `web/components/news-desk/NewsDesk.tsx`, `web/components/news-desk/NewsDesk.test.tsx`, `web/e2e/news-desk.spec.ts`

**Interfaces:**
- Consumes: `AskEvent`, `AnswerEvent`, `ChartQuery`, `isPinId` (Task 3); `Point` (Phase 3); the ask route (Task 5) and pin routes (Task 6).
- Produces: `readNdjson(body: ReadableStream<Uint8Array>, onEvent: (event: unknown) => void): Promise<void>`; `LineChart({ title, unit, points })`; `ChatPanel({ onPinned }: { onPinned: (row: IndicatorValue) => void })`; `IndicatorTable` gains optional `onRemove?: (id: string) => void`.

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/ndjson.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readNdjson } from "./ndjson";

function streamOf(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe("readNdjson", () => {
  it("emits each line once it is complete, even when split across chunks", async () => {
    const seen: unknown[] = [];
    await readNdjson(streamOf('{"a":1}\n{"b"', ':2}\n\n{"c":3}'), (e) => seen.push(e));
    expect(seen).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});
```

`web/components/news-desk/LineChart.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LineChart } from "./LineChart";

describe("LineChart", () => {
  it("draws one vertex per point and names the latest value", () => {
    const { container } = render(
      <LineChart
        title="IIP growth"
        unit="%"
        points={[
          { period: "May 2026", value: 5 },
          { period: "Jun 2026", value: 8.8 },
          { period: "Jul 2026", value: 6.7 },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "IIP growth: 3 points, latest 6.7% in Jul 2026" })).toBeInTheDocument();
    const vertices = container.querySelector("polyline")!.getAttribute("points")!.split(" ");
    expect(vertices).toHaveLength(3);
    expect(vertices.join(" ")).not.toContain("NaN");
  });

  it("draws a single point without dividing by zero", () => {
    const { container } = render(<LineChart title="GDP" unit="%" points={[{ period: "Q1 2026-27", value: 7.8 }]} />);
    expect(container.querySelector("polyline")!.getAttribute("points")).not.toContain("NaN");
  });
});
```

`web/components/news-desk/ChatPanel.test.tsx`:

```tsx
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
```

Append inside the `describe` in `web/components/news-desk/IndicatorTable.test.tsx` (add `vi` and `fireEvent` to the imports):

```tsx
  it("offers a remove control on pinned rows only", () => {
    const onRemove = vi.fn();
    const pin: IndicatorValue = { ...fresh, id: "pin-abc", label: "IIP manufacturing" };
    render(<IndicatorTable indicators={[fresh, pin]} now={NOW} onRemove={onRemove} />);
    expect(screen.queryByRole("button", { name: "Remove Retail inflation" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove IIP manufacturing" }));
    expect(onRemove).toHaveBeenCalledWith("pin-abc");
  });
```

Append inside the `describe` in `web/components/news-desk/NewsDesk.test.tsx`:

```tsx
  it("removes a pinned row after the server confirms", async () => {
    const pin = { ...SNAPSHOT.indicators[0], id: "pin-abc", label: "IIP manufacturing" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsDesk initial={{ ...SNAPSHOT, indicators: [...SNAPSHOT.indicators, pin] }} problem={null} nowIso={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove IIP manufacturing" }));
    await waitFor(() => expect(screen.queryByText("IIP manufacturing")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/news-desk/indicators/pin-abc", { method: "DELETE" });
  });

  it("offers the chat panel", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    expect(screen.getByRole("button", { name: "Ask MoSPI" })).toBeInTheDocument();
  });
```

Append to `web/e2e/news-desk.spec.ts`:

```ts
test("the chat panel opens and closes", async ({ page }) => {
  await page.goto("/tools/news-desk");
  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await page.getByRole("button", { name: "Ask MoSPI" }).click();
  await expect(page.getByRole("textbox", { name: "Question" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("textbox", { name: "Question" })).toBeHidden();
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/ndjson.test.ts components/news-desk`
Expected: FAIL — `./ndjson`, `./LineChart` and `./ChatPanel` do not exist; no remove control; no chat button.

- [ ] **Step 3: Implement**

`web/lib/news-desk/ndjson.ts`:

```ts
/** Calls onEvent with each line of an NDJSON body as soon as the line is complete. */
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) onEvent(JSON.parse(rest));
}
```

`web/components/news-desk/LineChart.tsx`:

```tsx
import type { Point } from "../../lib/news-desk/series";

// Hand-written rather than a chart library: one line chart in one place (spec D8).
const W = 320;
const H = 160;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

export function LineChart({ title, unit, points }: { title: string; unit: string; points: Point[] }) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = W - PAD.left - PAD.right;
  const height = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? width / 2 : (i * width) / (points.length - 1));
  const y = (v: number) => PAD.top + ((max - v) * height) / span;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure className="mt-3">
      <figcaption className="text-xs text-muted">{title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full"
        role="img"
        aria-label={`${title}: ${points.length} points, latest ${last.value}${unit} in ${last.period}`}
      >
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} className="stroke-rule" />
        <text x={PAD.left - 4} y={y(max) + 4} textAnchor="end" className="fill-muted text-[10px]">
          {max}
          {unit}
        </text>
        {max !== min && (
          <text x={PAD.left - 4} y={y(min) + 4} textAnchor="end" className="fill-muted text-[10px]">
            {min}
            {unit}
          </text>
        )}
        <polyline
          fill="none"
          strokeWidth={1.5}
          className="stroke-accent"
          points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
        />
        <text x={x(0)} y={H - 6} className="fill-muted text-[10px]">
          {first.period}
        </text>
        {points.length > 1 && (
          <text x={x(points.length - 1)} y={H - 6} textAnchor="end" className="fill-muted text-[10px]">
            {last.period}
          </text>
        )}
      </svg>
    </figure>
  );
}
```

`web/components/news-desk/ChatPanel.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import type { AnswerEvent, AskEvent, ChartQuery } from "../../lib/news-desk/chat-types";
import { readNdjson } from "../../lib/news-desk/ndjson";
import type { IndicatorValue } from "../../lib/news-desk/types";
import { LineChart } from "./LineChart";

type Entry = { id: number; question: string; steps: string[]; answer?: AnswerEvent; error?: string; done: boolean };

export function ChatPanel({ onPinned }: { onPinned: (row: IndicatorValue) => void }) {
  const [open, setOpen] = useState(false);
  // Kept while the tab is open so earlier answers can be scrolled back to and
  // pinned; none of it is sent with the next question (spec §7.1).
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const busy = entries.some((e) => !e.done);

  function update(id: number, change: (e: Entry) => Entry) {
    setEntries((all) => all.map((e) => (e.id === id ? change(e) : e)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    const id = Date.now();
    setEntries((all) => [...all, { id, question: q, steps: [], done: false }]);
    setQuestion("");
    try {
      const res = await fetch("/api/news-desk/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        update(id, (e) => ({ ...e, error: `Could not ask: ${body?.error ?? `status ${res.status}`}` }));
        return;
      }
      await readNdjson(res.body, (raw) => {
        const ev = raw as AskEvent;
        if (ev.type === "step") update(id, (e) => ({ ...e, steps: [...e.steps, ev.label] }));
        else if (ev.type === "answer") update(id, (e) => ({ ...e, answer: ev }));
        else if (ev.type === "error") update(id, (e) => ({ ...e, error: ev.message }));
      });
    } catch {
      update(id, (e) => ({ ...e, error: e.error ?? "The connection dropped before the answer arrived." }));
    } finally {
      update(id, (e) => ({ ...e, done: true, error: e.error ?? (e.answer ? undefined : "The answer did not arrive.") }));
    }
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="fixed right-6 bottom-6 z-20 rounded-md border border-rule bg-bg px-4 py-2 text-sm text-fg shadow"
      >
        Ask MoSPI
      </button>
      {open && (
        <section
          aria-label="Ask MoSPI"
          className="fixed right-4 bottom-20 z-20 flex max-h-[70vh] w-[min(28rem,calc(100vw-2rem))] flex-col border border-rule bg-bg shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-rule px-4 py-2">
            <h2 className="text-sm font-semibold text-fg">Ask MoSPI</h2>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted">
              Close
            </button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-3">
            {entries.length === 0 && (
              <p className="text-sm text-muted">Ask about Indian official statistics: prices, output, jobs, national accounts.</p>
            )}
            {entries.map((e) => (
              <article key={e.id}>
                <p className="text-sm font-medium text-fg">{e.question}</p>
                {e.steps.length > 0 && (
                  <ul className="mt-1 text-xs text-muted">
                    {e.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                {e.answer && (
                  <>
                    <p className="mt-2 text-sm whitespace-pre-wrap text-fg">{e.answer.text}</p>
                    {e.answer.chart && <LineChart {...e.answer.chart} />}
                    {e.answer.pinnable && e.answer.query && <PinForm query={e.answer.query} onPinned={onPinned} />}
                  </>
                )}
                {e.error && <p className="mt-2 text-sm text-accent">{e.error}</p>}
              </article>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-rule px-4 py-3">
            <input
              aria-label="Question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Each question is answered on its own."
              maxLength={500}
              className="min-w-0 flex-1 rounded-md border border-rule bg-bg px-2 py-1.5 text-sm text-fg"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-rule px-3 py-1.5 text-sm text-fg disabled:opacity-50"
            >
              Ask
            </button>
          </form>
        </section>
      )}
    </>
  );
}

function PinForm({ query, onPinned }: { query: ChartQuery; onPinned: (row: IndicatorValue) => void }) {
  const [label, setLabel] = useState(query.title);
  const [status, setStatus] = useState<{ saving: boolean; message?: string; done?: boolean }>({ saving: false });

  async function pin(event: FormEvent) {
    event.preventDefault();
    setStatus({ saving: true });
    const { title: _title, ...rest } = query;
    void _title;
    try {
      const res = await fetch("/api/news-desk/indicators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), ...rest }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus({ saving: false, message: `Could not pin: ${body?.error ?? `status ${res.status}`}` });
        return;
      }
      onPinned(body.indicator as IndicatorValue);
      setStatus({ saving: false, done: true, message: "Pinned. It fills in on the next Refresh." });
    } catch {
      setStatus({ saving: false, message: "Could not pin: network error" });
    }
  }

  if (status.done) return <p className="mt-2 text-xs text-muted">{status.message}</p>;
  return (
    <form onSubmit={pin} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        aria-label="Indicator name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={80}
        className="min-w-0 flex-1 rounded-md border border-rule bg-bg px-2 py-1 text-xs text-fg"
      />
      <button
        type="submit"
        disabled={status.saving || !label.trim()}
        className="rounded-md border border-rule px-2 py-1 text-xs text-fg disabled:opacity-50"
      >
        Pin
      </button>
      {status.message && <p className="w-full text-xs text-accent">{status.message}</p>}
    </form>
  );
}
```

In the `web/lib/news-desk/pins.ts` input, `unit` and the rest of `ChartQuery` map one to one onto `PinInput` apart from `title`, which becomes `label`; the form above sends exactly that.

`web/components/news-desk/IndicatorTable.tsx`: add `import { isPinId } from "../../lib/news-desk/chat-types";`, change the signature to

```tsx
export function IndicatorTable({
  indicators,
  now,
  onRemove,
}: {
  indicators: IndicatorValue[];
  now: Date;
  onRemove?: (id: string) => void;
}) {
```

and inside the first `<td>`, after the `{row.error && (…)}` block, add:

```tsx
              {onRemove && isPinId(row.id) && (
                <button
                  type="button"
                  aria-label={`Remove ${row.label}`}
                  onClick={() => onRemove(row.id)}
                  className="ml-1.5 text-muted hover:text-accent"
                >
                  ×
                </button>
              )}
```

`web/components/news-desk/NewsDesk.tsx`: import `ChatPanel` and `IndicatorValue` (type), add these handlers after `refresh()`:

```tsx
  async function remove(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/news-desk/indicators/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(`Could not remove the indicator: ${body?.error ?? `status ${res.status}`}`);
        return;
      }
      setSnapshot((s) => (s ? { ...s, indicators: s.indicators.filter((v) => v.id !== id) } : s));
    } catch {
      setError("Could not remove the indicator: network error");
    }
  }

  function pinned(row: IndicatorValue) {
    setSnapshot((s) => (s ? { ...s, indicators: [...s.indicators.filter((v) => v.id !== row.id), row] } : s));
  }
```

pass `onRemove={remove}` to `<IndicatorTable … />`, and render `<ChatPanel onPinned={pinned} />` as the last child of the component's root `<div>`.

`web/components/news-desk/LineChart.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LineChart } from "./LineChart";

const meta = {
  title: "News Desk/LineChart",
  component: LineChart,
} satisfies Meta<typeof LineChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Monthly: Story = {
  args: {
    title: "IIP growth, General",
    unit: "%",
    points: [
      { period: "Jan 2026", value: 5.2 },
      { period: "Feb 2026", value: 2.9 },
      { period: "Mar 2026", value: 3.0 },
      { period: "Apr 2026", value: 2.7 },
      { period: "May 2026", value: 5.0 },
      { period: "Jun 2026", value: 8.8 },
      { period: "Jul 2026", value: 6.7 },
    ],
  },
};

export const SinglePoint: Story = {
  args: { title: "GDP growth (real)", unit: "%", points: [{ period: "Q1 2026-27", value: 7.8 }] },
};
```

`web/components/news-desk/ChatPanel.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChatPanel } from "./ChatPanel";

const meta = {
  title: "News Desk/ChatPanel",
  component: ChatPanel,
} satisfies Meta<typeof ChatPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

// Closed until the "Ask MoSPI" button is clicked; asking needs the API route.
export const Default: Story = {
  args: { onPinned: () => {} },
};
```

- [ ] **Step 4: Run tests, lint and type check**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk components/news-desk && npm run lint && npx tsc --noEmit`
Expected: PASS, no lint or type errors.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/ndjson.ts web/lib/news-desk/ndjson.test.ts web/components/news-desk web/e2e/news-desk.spec.ts
git commit -m "feat(news-desk): Ask MoSPI chat panel with charts, pinning and unpinning

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 8: Measure, update docs, open the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-news-desk-design.md` (§4, §6.3, §6.4, §7.2, §7.3, §8, §10, §12, §13), `CHANGELOG.md`, epic #253 body

- [ ] **Step 1: Full local gate**

Run: `cd /e/Personal/looper/web && npm test && npm run lint && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build && npm run test:e2e`
Expected: all green. Run nothing else heavy at the same time: the full e2e run times out on `page.goto` under load. Rerun any timed-out spec on its own and report both runs.

- [ ] **Step 2: Measure real questions against the dev bucket**

This calls OpenRouter (a few rupees) and writes `news-desk/indicators.json` and `news-desk/snapshot.json` in the dev bucket when pinning.

```bash
cd /e/Personal/looper/web && \
  OPENROUTER_API_KEY="$(grep openrouter_api_key ../infra/main/terraform.tfvars | cut -d'"' -f2)" \
  OPENROUTER_BASE_URL=https://openrouter.ai/api/v1 NEWS_DESK_MODEL=anthropic/claude-haiku-4.5 \
  S3_BUCKET_NAME=bgm-looper-audio-dev-223376380711 APP_AWS_REGION=us-east-1 AWS_PROFILE=personal \
  APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev
```

Log in, then ask these three through `POST /api/news-desk/ask` and read each `news-desk: question took …` log line (turns, MoSPI calls, input tokens, seconds, cost):

1. "What was retail inflation in August 2026?"
2. "How has IIP growth moved over the last twelve months?" (expect a chart and `pinnable: true`)
3. "What is the urban unemployment rate for women?"

Then in the browser at `http://localhost:3000/tools/news-desk`: ask question 2, pin its chart, press Refresh and check the pinned row fills with values; remove it and check it disappears. Convert the costs to rupees at the day's rate (look it up; do not use Cost Explorer). Stop the server and `git checkout web/next-env.d.ts` if `next dev` touched it.

- [ ] **Step 3: Update the spec**

- §4: the Ask MoSPI button and panel as built; only pinned rows have a remove control.
- §6.3: `indicators.json` holds only pins; the list is the defaults followed by the pins; why (stored defaults would never pick up a code change, §6.2). Pin ids (`pin-` + 12 hex of a SHA-256 of the query), closing #269.
- §6.4: a month inside a `YYYY-YY` year is not placed, closing #268.
- §7.2: tool definitions from a recorded `tools/list` without `user_query`; compaction walks the whole object and keeps codes and labels, dropping parent codes; the 24,000-character cap and why; a rejected MoSPI call goes back to the model, an unreachable MoSPI ends the stream; the 30 s and 55 s deadlines; `match` in `chart`.
- §7.3: pin and unpin also update the snapshot; a duplicate pin is 409; a pin or unpin writes nothing when `indicators.json` cannot be read; defaults cannot be removed.
- §8: `indicators.json` holds pins only.
- §10: the measured chat cost per question, with the three questions' turns, tokens and time.
- §12: split "MoSPI down … in chat" into unreachable (error event) and rejected (returned to the model); add "question runs past 30 s → forced answer; past 55 s → error event".

- [ ] **Step 4: CHANGELOG**

Under `## [Unreleased]` → `### Added`, edit the first News Desk bullet's last sentence "The chat assistant follows in a later phase (#253)." to remove it, and add after the indicators bullet:

```md
- News Desk chat: an Ask MoSPI panel answers questions about Indian official statistics from MoSPI's data, showing each step as it works and drawing a chart when the answer is a time series. A chart can be pinned into the indicator table, and pinned rows can be removed. Each question costs about ₹<measured> (#253).
```

- [ ] **Step 5: Commit, push, PR**

```bash
cd /e/Personal/looper && git add docs CHANGELOG.md && git commit -m "docs(news-desk): chat as built and its measured cost

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/news-desk-phase-4
gh pr create --base dev --title "feat: News Desk Phase 4 — Ask MoSPI chat and pinning" --body "…"
```

PR body: what changed (loop, route, compaction, pins, panel, chart), the deviations and why, the measured cost and time per question, test evidence, no infra change, and `Closes #<N>`, `Closes #268`, `Closes #269`. Update the epic's Phase 4 line. Then follow the `merging-a-pr` skill; do not merge without it.

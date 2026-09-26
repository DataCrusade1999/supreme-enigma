# News Desk Phase 3 (Indicators) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a table of official MoSPI indicators beside the News Desk headlines, refreshed by the same Refresh button.

**Architecture:** `mospi.ts` makes one JSON-RPC `tools/call` to MoSPI's stateless MCP server and parses the single SSE event. `series.ts` turns MoSPI rows into time-sorted points. `indicators.ts` runs every indicator definition in parallel, keeping the previous values when one fails. `runRefresh` runs indicators alongside the feed-and-tag chain and saves both in the snapshot. `NewsDesk` renders the headlines and an `IndicatorTable` from the same client state.

**Tech Stack:** Next.js 16, React 19, TypeScript, zod 4, Vitest, Storybook.

**Spec:** `docs/superpowers/specs/2026-09-25-news-desk-design.md` (§6, §8, §9, §12, §13). Epic #253.

## Global Constraints

- MoSPI endpoint `https://mcp.mospi.gov.in/`, no key, no session; `Accept: application/json, text/event-stream`; timeout 10 s per call (spec §6.1).
- MoSPI rejects `limit` above 100 (found 2026-09-26). Every `get_data` call sends `limit: "100"`.
- `news-desk/indicators.json` is read-only in this phase: read it, or use the defaults when it does not exist. Writing it (pin/unpin) is Phase 4.
- Snapshot `version` stays `1`; new fields get zod defaults so the Phase 2 snapshot in the dev bucket still reads.
- No infra change. MoSPI needs no credentials; `news-desk/*` IAM already covers `indicators.json`.
- Lib tests start with `// @vitest-environment node`. Fixtures are read with `readFileSync(join(__dirname, "__fixtures__", …))`, as `parse.test.ts` does.
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`. Plain prose in docs, comments and commit messages.

### What the MoSPI survey on 2026-09-26 found (binding on the defaults)

| Default | Dataset and filters | valueField | Latest two points in the recorded fixtures |
|---|---|---|---|
| Retail inflation | CPI `base_year=2024, series=Current, state_code=1, sector_code=3, division_code=0` | `inflation` | Aug 2026 4.82, Jul 2026 4.45 |
| Food and beverages inflation | CPI same, `division_code=1`, **row match `code=01`** | `inflation` | Aug 2026 5.66, Jul 2026 5.24 |
| IIP growth | IIP `base_year=2022-23, frequency=Monthly, type=General` | `growth_rate` | Jul 2026 6.7, Jun 2026 8.8 |
| GDP growth (real) | NAS `base_year=2022-23, series=Current, frequency_code=Quarterly, indicator_code=22` | `constant_price` | Q1 2026-27 7.8, Q4 2025-26 8.6 |
| Unemployment (urban) | PLFS `indicator_code=3, frequency_code=3, state_code=99, gender_code=3, age_code=1, sector_code=2` | `value` | Aug 2026 6.8, Jul 2026 6.7 |

Deviations from spec §6.3, each recorded in Task 7's spec edit:

- CPI requires `series=Current`; the spec's "verified" filters omit it and MoSPI answers `missing_required: ["series"]`.
- A CPI base-2024 division returns every group, class and sub-class row beneath it (219 rows a month for food). `group_code` and `class_code` are rejected in base 2024. So a definition gets an optional `match` (row fields that must equal given values), and a matched definition pages through results until it has two points, up to 4 pages. Today the previous month's food row is on page 3.
- PLFS quarterly (`frequency_code=2`) ends at Oct–Dec 2025 and mislabels years; the monthly series (`frequency_code=3`, from 2025, CWS by construction) runs to Aug 2026. The default uses monthly.
- ISP has no headline index: `type_code=1` (General) returns no rows, only 19 sub-sectors exist. **There is no Services growth default.** The table ships with five rows.
- GDP growth comes from NAS indicator 22 (GDP Growth Rate), real = `constant_price`. No year-on-year computation is needed.
- Base-2024 CPI General returns 2025 months with `inflation: null` (index only). A null value drops that point; it does not invalidate the series (spec §6.4 only covers unplaceable rows).
- MoSPI signals a rejected query in three ways besides a JSON-RPC error: `result.isError`, `{"error", "valid": false, …}`, and `{"error": "An error occurred: 400 …", "troubleshooting": …}` with no `valid` key. Any content object with an `error` key is a failure.

## Review Focus

1. **MoSPI slow or down during a refresh.** Expect each call aborted at 10 s, that row keeping its previous values with `error` set, and the snapshot still written before the route's 60 s limit. Indicators run concurrently with the feed-and-tag chain (worst case about 48 s), and the food row pages at most 4 times (40 s). Pinned in Task 4 (a failing `callTool` keeps previous values) and Task 5 (indicators start before feeds finish).
2. **The Phase 2 snapshot has no `indicators` field.** Expect it to read, the table to say indicators load on the next Refresh, and the next refresh to fill it. Pinned in Task 3.
3. **Filters that match more than one series** (a pinned query in Phase 4, or a MoSPI change). Expect an error on that row, never a number taken from the wrong series. Pinned in Task 2 (two rows for one period invalidate the series) and Task 4 (food without `match` would fail).
4. **An indicator that has never loaded fails.** Expect a row showing "—" with the error on hover, not a crash or a missing row; a later success fills it. Pinned in Task 4 and Task 6.
5. **MoSPI rejects the query** (bad filter, over-limit). Expect the row's error to carry MoSPI's message. Pinned in Task 1 (both recorded error bodies throw) and Task 4.

---

### Task 0: Issue and branch

No code.

- [ ] **Step 1: File the Phase 3 issue**

```bash
cd /e/Personal/looper && gh issue create \
  --title "News Desk Phase 3: MoSPI indicators" \
  --label "enhancement" --label "priority: medium" --label "area: finance" \
  --body "$(cat <<'EOF'
## Summary

Add a table of official MoSPI indicators beside the News Desk headlines: retail inflation, food and beverages inflation, IIP growth, real GDP growth and urban unemployment. Refresh updates them along with the headlines.

Part of #253. Spec: `docs/superpowers/specs/2026-09-25-news-desk-design.md` §6. Plan: `docs/superpowers/plans/2026-09-26-news-desk-phase-3.md`.

The spec's sixth default, services growth (ISP), is dropped: MoSPI publishes no headline ISP index, only 19 sub-sectors.

## Done when

- A refresh fetches every indicator in parallel with the headlines; a failed one keeps its last good values and shows it is stale.
- The table shows Indicator, Period, Latest and Prev, sticky beside the headlines on desktop and above them on narrow screens.
- Default filters are pinned by tests against responses recorded from MoSPI.
- Refresh time is measured on the dev bucket and stays under the route's 60 s.
EOF
)"
```

Note the number as `<N>`. In epic #253's body, change `- [ ] **Phase 3: MoSPI client and indicator table.**` to `- [ ] #<N> **Phase 3: MoSPI client and indicator table.**` (`gh issue view 253 --json body -q .body > body.md`, edit, `gh issue edit 253 --body-file body.md`).

- [ ] **Step 2: Branch off `dev` and commit the plan**

The MoSPI fixtures recorded during planning are untracked in `web/lib/news-desk/__fixtures__/mospi/`; they carry over and are committed in Task 1.

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/news-desk-phase-3
git add docs/superpowers/plans/2026-09-26-news-desk-phase-3.md
git commit -m "docs: News Desk Phase 3 plan

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 1: `mospi.ts`

**Files:**
- Create: `web/lib/news-desk/mospi.ts`
- Test: `web/lib/news-desk/mospi.test.ts`
- Commit: `web/lib/news-desk/__fixtures__/mospi/*` (recorded 2026-09-26)

**Interfaces:**
- Produces: `callTool(name: string, args: Record<string, unknown>): Promise<unknown>` returning the parsed JSON of `result.content[0].text`; `class MospiError extends Error`. Throws `MospiError` on HTTP status, JSON-RPC error, `isError`, unparseable content, or a content object with an `error` key. Aborts after 10 s.

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/mospi.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, MospiError } from "./mospi";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", "mospi", name), "utf8");

function sse(payload: unknown) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}
function toolText(text: string) {
  return sse({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
}

describe("callTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a stateless tools/call and parses the single SSE event", async () => {
    const fetchMock = vi.fn(async () => new Response(fixture("cpi-general.sse.txt")));
    vi.stubGlobal("fetch", fetchMock);

    const result = (await callTool("get_data", { dataset: "CPI", filters: { limit: "100" } })) as {
      data: { month: string; inflation: string | null }[];
    };

    expect(result.data[0]).toMatchObject({ month: "August", inflation: "4.82" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mcp.mospi.gov.in/");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json, text/event-stream");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "get_data", arguments: { dataset: "CPI", filters: { limit: "100" } } },
    });
  });

  it("throws on MoSPI's upstream-400 body, which has an error key but no valid key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(fixture("error-limit.sse.txt"))));
    await expect(callTool("get_data", {})).rejects.toThrow(/MoSPI rejected the query: An error occurred: 400/);
  });

  it("throws on MoSPI's invalid-filter body", async () => {
    const body = JSON.stringify({ error: "Invalid parameters", valid: false, missing_required: ["series"] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(toolText(body))));
    await expect(callTool("get_data", {})).rejects.toThrow("MoSPI rejected the query: Invalid parameters");
  });

  it("throws on a JSON-RPC error", async () => {
    const body = sse({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(callTool("nope", {})).rejects.toThrow("MoSPI error: Unknown tool");
  });

  it("throws when the tool reports isError", async () => {
    const body = sse({
      jsonrpc: "2.0",
      id: 1,
      result: { isError: true, content: [{ type: "text", text: "dataset is required" }] },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(callTool("get_data", {})).rejects.toThrow("MoSPI tool error: dataset is required");
  });

  it("throws on a non-2xx status without reading the body as JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    await expect(callTool("get_data", {})).rejects.toThrow("MoSPI status 502");
  });

  it("throws a MospiError when the content is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(toolText("Service temporarily unavailable"))));
    await expect(callTool("get_data", {})).rejects.toBeInstanceOf(MospiError);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/mospi.test.ts`
Expected: FAIL — cannot resolve `./mospi`.

- [ ] **Step 3: Implement `web/lib/news-desk/mospi.ts`**

```ts
// MoSPI's MCP server is stateless: a tools/call works without initialize and
// answers with one SSE event holding the JSON-RPC response. Hand-written rather
// than the MCP SDK; see spec D7 and §6.1.
const MOSPI_URL = "https://mcp.mospi.gov.in/";
const TIMEOUT_MS = 10_000;

export class MospiError extends Error {}

let nextId = 1;

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(MOSPI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!res.ok) throw new MospiError(`MoSPI status ${res.status}`);

  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  let rpc: {
    error?: { message?: string };
    result?: { isError?: boolean; content?: { text?: unknown }[] };
  };
  try {
    rpc = JSON.parse(line ? line.slice(5) : body);
  } catch {
    throw new MospiError("MoSPI response is not JSON-RPC");
  }
  if (rpc.error) throw new MospiError(`MoSPI error: ${rpc.error.message ?? "unknown"}`);

  const text = rpc.result?.content?.[0]?.text;
  if (typeof text !== "string") throw new MospiError("MoSPI response has no content");
  if (rpc.result?.isError) throw new MospiError(`MoSPI tool error: ${text.slice(0, 200)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MospiError(`MoSPI content is not JSON: ${text.slice(0, 100)}`);
  }
  // MoSPI reports a rejected query inside a successful response, in two shapes:
  // {"error", "valid": false} for invalid filters and {"error", "troubleshooting"}
  // when its upstream API returns 400. Both carry an error key.
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    throw new MospiError(`MoSPI rejected the query: ${String(parsed.error).slice(0, 200)}`);
  }
  return parsed;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/mospi.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/mospi.ts web/lib/news-desk/mospi.test.ts web/lib/news-desk/__fixtures__/mospi
git commit -m "feat(news-desk): MoSPI MCP client with recorded fixtures

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: `series.ts`

**Files:**
- Create: `web/lib/news-desk/series.ts`
- Test: `web/lib/news-desk/series.test.ts`

**Interfaces:**
- Produces: `type Point = { period: string; value: number }`; `type SeriesResult = { ok: true; points: Point[] } | { ok: false; reason: string }`; `toSeries(rows: Record<string, unknown>[], valueField: string): SeriesResult`. Points are sorted oldest first. Period labels: `"Aug 2026"` (a month), `"Q1 2026-27"` (a fiscal quarter), `"2025-26"` (a fiscal year).

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/series.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toSeries } from "./series";

const rows = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "mospi", name), "utf8")).data as Record<
    string,
    unknown
  >[];

describe("toSeries", () => {
  it("places calendar months and skips points whose value is null", () => {
    // Base-2024 CPI returns 2025 months with an index but no inflation figure.
    const result = toSeries(rows("cpi-general.json"), "inflation");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toHaveLength(8);
    expect(result.points[0]).toEqual({ period: "Jan 2026", value: 2.74 });
    expect(result.points.slice(-2)).toEqual([
      { period: "Jul 2026", value: 4.45 },
      { period: "Aug 2026", value: 4.82 },
    ]);
  });

  it("accepts a numeric year, as IIP sends it", () => {
    const result = toSeries(rows("iip-general.json"), "growth_rate");
    if (!result.ok) throw new Error(result.reason);
    expect(result.points.slice(-2)).toEqual([
      { period: "Jun 2026", value: 8.8 },
      { period: "Jul 2026", value: 6.7 },
    ]);
  });

  it("sorts fiscal quarters that arrive out of order", () => {
    // NAS returns the newest quarter first, then the rest oldest first.
    const result = toSeries(rows("nas-gdp-growth.json"), "constant_price");
    if (!result.ok) throw new Error(result.reason);
    expect(result.points[0]).toEqual({ period: "Q1 2023-24", value: 6.6 });
    expect(result.points.slice(-2)).toEqual([
      { period: "Q4 2025-26", value: 8.6 },
      { period: "Q1 2026-27", value: 7.8 },
    ]);
  });

  it("sorts months from two calendar years that arrive out of order", () => {
    const result = toSeries(rows("plfs-urban-ur.json"), "value");
    if (!result.ok) throw new Error(result.reason);
    expect(result.points[0].period).toBe("Apr 2025");
    expect(result.points.slice(-2)).toEqual([
      { period: "Jul 2026", value: 6.7 },
      { period: "Aug 2026", value: 6.8 },
    ]);
  });

  it("places a month in a fiscal year: April–December in the first year, January–March in the second", () => {
    const result = toSeries(
      [
        { year: "2025-26", month: "March", growth_rate: "5.0" },
        { year: "2026-27", month: "June", growth_rate: "6.0" },
        { year: "2025-26", month: "December", growth_rate: "4.0" },
      ],
      "growth_rate",
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.points.map((p) => p.period)).toEqual(["Dec 2025", "Mar 2026", "Jun 2026"]);
  });

  it("places a bare fiscal year", () => {
    const result = toSeries(
      [
        { year: "2024-25", value: "7.1" },
        { year: "2023-24", value: "9.2" },
      ],
      "value",
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.points.map((p) => p.period)).toEqual(["2023-24", "2024-25"]);
  });

  it("is invalid when a row cannot be placed in time", () => {
    // PLFS quarterly labels quarters "Apr-Jun", which has no fixed place in a year.
    const result = toSeries([{ year: "2019", quarter: "Apr-Jun", value: "21.6" }], "value");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/cannot place a row in time/) });
  });

  it("is invalid when two rows share a period, since the filters match more than one series", () => {
    const result = toSeries(
      [
        { year: "2026", month: "August", inflation: "5.66" },
        { year: "2026", month: "August", inflation: "0.10" },
      ],
      "inflation",
    );
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/two rows for Aug 2026/) });
  });

  it("is invalid when a value is not a number", () => {
    const result = toSeries([{ year: "2026", month: "August", inflation: "n.a." }], "inflation");
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/not a number/) });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/series.test.ts`
Expected: FAIL — cannot resolve `./series`.

- [ ] **Step 3: Implement `web/lib/news-desk/series.ts`**

```ts
// Turns MoSPI get_data rows into [{period, value}] sorted oldest first. The same
// function serves the indicator table and, in Phase 4, chat charts, so a pinned
// row always matches its chart. See spec §6.4.

export type Point = { period: string; value: number };
export type SeriesResult = { ok: true; points: Point[] } | { ok: false; reason: string };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CALENDAR_YEAR = /^\d{4}$/;
const FISCAL_YEAR = /^(\d{4})-\d{2}$/;
const FISCAL_QUARTER = /^Q([1-4])$/i;

/** A sort key in months since year 0, and a label. Null when the row has no
 * place in time we recognise. */
function place(row: Record<string, unknown>): { key: number; label: string } | null {
  const year = String(row.year ?? "").trim();
  const month = typeof row.month === "string" ? MONTHS.indexOf(row.month.trim().toLowerCase()) : -1;
  const quarter = typeof row.quarter === "string" ? FISCAL_QUARTER.exec(row.quarter.trim()) : null;
  const fiscal = FISCAL_YEAR.exec(year);

  if (CALENDAR_YEAR.test(year) && month >= 0) {
    return { key: Number(year) * 12 + month, label: `${SHORT[month]} ${year}` };
  }
  if (fiscal && month >= 0) {
    // India's fiscal year runs April to March.
    const calendarYear = Number(fiscal[1]) + (month < 3 ? 1 : 0);
    return { key: calendarYear * 12 + month, label: `${SHORT[month]} ${calendarYear}` };
  }
  if (fiscal && quarter) {
    const q = Number(quarter[1]);
    return { key: Number(fiscal[1]) * 12 + 3 + (q - 1) * 3, label: `Q${q} ${year}` };
  }
  if (fiscal && row.month == null && row.quarter == null) {
    return { key: Number(fiscal[1]) * 12 + 3, label: year };
  }
  return null;
}

export function toSeries(rows: Record<string, unknown>[], valueField: string): SeriesResult {
  const points: (Point & { key: number })[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const at = place(row);
    if (!at) return { ok: false, reason: `cannot place a row in time (year ${String(row.year)})` };
    const raw = row[valueField];
    // Base-2024 CPI has 2025 rows with an index but a null inflation figure.
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false, reason: `${valueField} is not a number: ${String(raw)}` };
    // Two rows for one period means the filters did not narrow MoSPI to one
    // series; picking either would show a number from the wrong series.
    if (seen.has(at.key)) {
      return { ok: false, reason: `two rows for ${at.label}; the filters match more than one series` };
    }
    seen.add(at.key);
    points.push({ key: at.key, period: at.label, value });
  }
  points.sort((a, b) => a.key - b.key);
  return { ok: true, points: points.map(({ period, value }) => ({ period, value })) };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/series.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/series.ts web/lib/news-desk/series.test.ts
git commit -m "feat(news-desk): turn MoSPI rows into time-sorted series

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: Indicator types, defaults and definitions storage

**Files:**
- Modify: `web/lib/news-desk/types.ts`, `web/lib/news-desk/store.ts`
- Create: `web/lib/news-desk/defaults.ts`
- Modify (fixtures only): every `Snapshot` literal — `web/lib/news-desk/refresh.test.ts`, `web/lib/news-desk/store.test.ts`, `web/components/news-desk/NewsDesk.test.tsx`, `web/app/api/news-desk/refresh/route.test.ts`
- Test: `web/lib/news-desk/store.test.ts`

**Interfaces:**
- Produces: `indicatorDefSchema`, `type IndicatorDef = { id; label; dataset; filters: Record<string,string>; valueField; unit; match?: Record<string,string> }`; `indicatorValueSchema`, `type IndicatorValue = { id; label; unit; period: string|null; latest: number|null; prevPeriod: string|null; prev: number|null; lastGoodAt: string|null; error?: string }`; `Snapshot.indicators: IndicatorValue[]` (defaults to `[]`); `DEFAULT_INDICATORS: IndicatorDef[]` in `defaults.ts`; `INDICATORS_KEY = "news-desk/indicators.json"`; `readIndicatorDefs(): Promise<IndicatorDef[]>` in `store.ts`.

`label` and `unit` are copied into each `IndicatorValue` so the page renders from the snapshot alone (spec §8 lists only the values; the page reads only the snapshot).

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` in `web/lib/news-desk/store.test.ts` (it already mocks `@/lib/aws`'s `getObjectBytes`; import `readIndicatorDefs` and `INDICATORS_KEY` from `./store` and `DEFAULT_INDICATORS` from `./defaults`):

```ts
  it("reads a Phase 2 snapshot, which has no indicators, with an empty list", async () => {
    const phase2 = {
      version: 1,
      refreshedAt: "2026-09-26T09:00:00.000Z",
      headlines: [],
      sourceErrors: [],
    };
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(phase2)));
    expect((await readSnapshot())?.indicators).toEqual([]);
  });

  it("uses the default indicators when none are stored", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
    expect(await readIndicatorDefs()).toEqual(DEFAULT_INDICATORS);
    expect(vi.mocked(getObjectBytes)).toHaveBeenCalledWith("bucket-test", INDICATORS_KEY);
  });

  it("reads stored indicator definitions", async () => {
    const stored = [
      { id: "x", label: "X", dataset: "IIP", filters: { type: "General" }, valueField: "growth_rate", unit: "%" },
    ];
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(stored)));
    expect(await readIndicatorDefs()).toEqual(stored);
  });

  it("surfaces an S3 failure reading indicator definitions", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(Object.assign(new Error("denied"), { name: "AccessDenied" }));
    await expect(readIndicatorDefs()).rejects.toThrow("denied");
  });
```

Use whatever bucket name the file's `beforeEach` sets in `S3_BUCKET_NAME` in place of `"bucket-test"` (check the top of the file).

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/store.test.ts`
Expected: FAIL — `readIndicatorDefs` and `./defaults` do not exist; `indicators` is undefined.

- [ ] **Step 3: Implement**

In `web/lib/news-desk/types.ts`, before `snapshotSchema`:

```ts
export const indicatorDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  dataset: z.string(),
  filters: z.record(z.string(), z.string()),
  valueField: z.string(),
  unit: z.string(),
  // Row fields that must equal these values. Needed when the filters cannot
  // narrow MoSPI to one series: a base-2024 CPI division also returns every
  // group and class beneath it. See spec §6.3.
  match: z.record(z.string(), z.string()).optional(),
});
export type IndicatorDef = z.infer<typeof indicatorDefSchema>;

export const indicatorValueSchema = z.object({
  id: z.string(),
  label: z.string(),
  unit: z.string(),
  period: z.string().nullable(),
  latest: z.number().nullable(),
  prevPeriod: z.string().nullable(),
  prev: z.number().nullable(),
  // Unchanged by a failed refresh, so the table can say how stale a row is.
  lastGoodAt: z.string().nullable(),
  error: z.string().optional(),
});
export type IndicatorValue = z.infer<typeof indicatorValueSchema>;
```

and in `snapshotSchema`, after `headlines`:

```ts
  // Defaulted so a Phase 2 snapshot still reads; the next refresh fills it.
  indicators: z.array(indicatorValueSchema).default([]),
```

`web/lib/news-desk/defaults.ts`:

```ts
import type { IndicatorDef } from "./types";

// Filters verified against MoSPI on 2026-09-26 and pinned by indicators.test.ts
// against responses recorded that day. Each definition is one query against one
// base year; when MoSPI rebases a dataset, update it here (spec §6.2).
export const DEFAULT_INDICATORS: IndicatorDef[] = [
  {
    id: "cpi-headline",
    label: "Retail inflation",
    dataset: "CPI",
    filters: { base_year: "2024", series: "Current", state_code: "1", sector_code: "3", division_code: "0" },
    valueField: "inflation",
    unit: "%",
  },
  {
    id: "cpi-food",
    label: "Food and beverages inflation",
    dataset: "CPI",
    filters: { base_year: "2024", series: "Current", state_code: "1", sector_code: "3", division_code: "1" },
    valueField: "inflation",
    unit: "%",
    // The division's own row; the rest are its groups, classes and sub-classes.
    match: { code: "01" },
  },
  {
    id: "iip",
    label: "IIP growth",
    dataset: "IIP",
    filters: { base_year: "2022-23", frequency: "Monthly", type: "General" },
    valueField: "growth_rate",
    unit: "%",
  },
  {
    id: "gdp",
    label: "GDP growth (real)",
    dataset: "NAS",
    filters: { base_year: "2022-23", series: "Current", frequency_code: "Quarterly", indicator_code: "22" },
    valueField: "constant_price",
    unit: "%",
  },
  {
    id: "unemployment-urban",
    label: "Unemployment (urban)",
    dataset: "PLFS",
    // Monthly, which runs from 2025 and is current; the quarterly series stops
    // at Oct–Dec 2025. Monthly figures are current weekly status by construction.
    filters: {
      indicator_code: "3",
      frequency_code: "3",
      state_code: "99",
      gender_code: "3",
      age_code: "1",
      sector_code: "2",
    },
    valueField: "value",
    unit: "%",
  },
];
```

In `web/lib/news-desk/store.ts`, add `import { z } from "zod";`, `import { DEFAULT_INDICATORS } from "./defaults";`, extend the types import with `indicatorDefSchema, type IndicatorDef`, and add:

```ts
export const INDICATORS_KEY = "news-desk/indicators.json";

/** The indicator definitions, or the defaults when none are stored. Phase 4's
 * pin and unpin are the only writers. */
export async function readIndicatorDefs(): Promise<IndicatorDef[]> {
  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(bucket(), INDICATORS_KEY);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return DEFAULT_INDICATORS;
    throw err;
  }
  return z.array(indicatorDefSchema).parse(JSON.parse(bytes.toString("utf8")));
}
```

Add `indicators: [],` after `headlines` in every `Snapshot` object literal listed under **Files** (find them with `grep -rn "sourceErrors:" web/lib web/components web/app --include=*.test.ts --include=*.test.tsx`), and in the `snapshot` built in `web/lib/news-desk/refresh.ts` (Task 5 replaces that line).

- [ ] **Step 4: Run the news-desk tests and the type check**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk components/news-desk app/api/news-desk && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk web/components/news-desk web/app/api/news-desk
git commit -m "feat(news-desk): indicator definitions, defaults and snapshot field

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: `indicators.ts`

**Files:**
- Create: `web/lib/news-desk/indicators.ts`
- Test: `web/lib/news-desk/indicators.test.ts`

**Interfaces:**
- Consumes: `callTool` (Task 1), `toSeries`/`Point` (Task 2), `IndicatorDef`/`IndicatorValue`/`DEFAULT_INDICATORS` (Task 3).
- Produces: `fetchSeries(def: IndicatorDef): Promise<Point[]>` (throws on failure or no values); `refreshIndicators(defs: IndicatorDef[], previous: IndicatorValue[], now: Date): Promise<IndicatorValue[]>` (never throws; one value per def, in def order).

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/indicators.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mospi", async () => {
  const actual = await vi.importActual<typeof import("./mospi")>("./mospi");
  return { ...actual, callTool: vi.fn() };
});

import { DEFAULT_INDICATORS } from "./defaults";
import { fetchSeries, refreshIndicators } from "./indicators";
import { callTool, MospiError } from "./mospi";
import type { IndicatorDef, IndicatorValue } from "./types";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "mospi", name), "utf8"));

const NOW = new Date("2026-09-26T12:00:00.000Z");
const byId = (id: string) => DEFAULT_INDICATORS.find((d) => d.id === id)!;

type Args = { dataset: string; filters: Record<string, string> };

// Answers get_data from the responses recorded on 2026-09-26.
function recordedMospi(_name: string, args: Record<string, unknown>) {
  const { dataset, filters } = args as Args;
  if (dataset === "CPI" && filters.division_code === "0") return fixture("cpi-general.json");
  if (dataset === "CPI" && filters.division_code === "1") return fixture(`cpi-food-p${filters.page}.json`);
  if (dataset === "IIP") return fixture("iip-general.json");
  if (dataset === "NAS") return fixture("nas-gdp-growth.json");
  if (dataset === "PLFS") return fixture("plfs-urban-ur.json");
  throw new Error(`no fixture for ${dataset}`);
}

describe("fetchSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callTool).mockImplementation(async (name, args) => recordedMospi(name, args));
  });

  it.each([
    ["cpi-headline", { period: "Jul 2026", value: 4.45 }, { period: "Aug 2026", value: 4.82 }],
    ["cpi-food", { period: "Jul 2026", value: 5.24 }, { period: "Aug 2026", value: 5.66 }],
    ["iip", { period: "Jun 2026", value: 8.8 }, { period: "Jul 2026", value: 6.7 }],
    ["gdp", { period: "Q4 2025-26", value: 8.6 }, { period: "Q1 2026-27", value: 7.8 }],
    ["unemployment-urban", { period: "Jul 2026", value: 6.7 }, { period: "Aug 2026", value: 6.8 }],
  ])("default %s reads its latest two points from the recorded response", async (id, prev, latest) => {
    const points = await fetchSeries(byId(id));
    expect(points.slice(-2)).toEqual([prev, latest]);
  });

  it("sends limit 100 and page 1, MoSPI's maximum page size", async () => {
    await fetchSeries(byId("iip"));
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("get_data", {
      dataset: "IIP",
      filters: { base_year: "2022-23", frequency: "Monthly", type: "General", limit: "100", page: "1" },
    });
  });

  it("pages a matched definition until it has two points, and no further", async () => {
    await fetchSeries(byId("cpi-food"));
    expect(vi.mocked(callTool).mock.calls.map(([, a]) => (a as Args).filters.page)).toEqual(["1", "2", "3"]);
  });

  it("stops paging a matched definition after four pages", async () => {
    vi.mocked(callTool).mockImplementation(async () => fixture("cpi-food-p2.json"));
    await expect(fetchSeries(byId("cpi-food"))).rejects.toThrow("MoSPI returned no values for these filters");
    expect(callTool).toHaveBeenCalledTimes(4);
  });

  it("fails rather than mixing series when the filters match more than one", async () => {
    const unmatched: IndicatorDef = { ...byId("cpi-food"), match: undefined };
    await expect(fetchSeries(unmatched)).rejects.toThrow(/filters match more than one series/);
  });

  it("fails when MoSPI finds no rows", async () => {
    vi.mocked(callTool).mockResolvedValue({ data: [], msg: "No Data Found", statusCode: true });
    await expect(fetchSeries(byId("iip"))).rejects.toThrow("MoSPI returned no values for these filters");
  });
});

describe("refreshIndicators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the latest two points of every definition, in order", async () => {
    vi.mocked(callTool).mockImplementation(async (name, args) => recordedMospi(name, args));
    const values = await refreshIndicators(DEFAULT_INDICATORS, [], NOW);
    expect(values.map((v) => v.id)).toEqual(DEFAULT_INDICATORS.map((d) => d.id));
    expect(values[0]).toEqual({
      id: "cpi-headline",
      label: "Retail inflation",
      unit: "%",
      period: "Aug 2026",
      latest: 4.82,
      prevPeriod: "Jul 2026",
      prev: 4.45,
      lastGoodAt: NOW.toISOString(),
    });
  });

  it("keeps the previous values and lastGoodAt when a query fails", async () => {
    vi.mocked(callTool).mockRejectedValue(new MospiError("MoSPI status 503"));
    const previous: IndicatorValue = {
      id: "iip",
      label: "IIP growth",
      unit: "%",
      period: "Jun 2026",
      latest: 8.8,
      prevPeriod: "May 2026",
      prev: 5,
      lastGoodAt: "2026-09-20T08:00:00.000Z",
    };
    const [value] = await refreshIndicators([byId("iip")], [previous], NOW);
    expect(value).toEqual({ ...previous, error: "MoSPI status 503" });
  });

  it("returns an empty row with the error when an indicator has never loaded", async () => {
    vi.mocked(callTool).mockRejectedValue(new MospiError("MoSPI rejected the query: Invalid parameters"));
    const [value] = await refreshIndicators([byId("gdp")], [], NOW);
    expect(value).toEqual({
      id: "gdp",
      label: "GDP growth (real)",
      unit: "%",
      period: null,
      latest: null,
      prevPeriod: null,
      prev: null,
      lastGoodAt: null,
      error: "MoSPI rejected the query: Invalid parameters",
    });
  });

  it("gives a series with one point no previous value", async () => {
    vi.mocked(callTool).mockResolvedValue({ data: [{ year: 2026, month: "July", growth_rate: "6.7" }] });
    const [value] = await refreshIndicators([byId("iip")], [], NOW);
    expect(value).toMatchObject({ period: "Jul 2026", latest: 6.7, prevPeriod: null, prev: null });
  });

  it("takes the label and unit from the current definition, not the previous value", async () => {
    vi.mocked(callTool).mockImplementation(async (name, args) => recordedMospi(name, args));
    const renamed: IndicatorDef = { ...byId("iip"), label: "Industrial output growth" };
    const [value] = await refreshIndicators([renamed], [], NOW);
    expect(value.label).toBe("Industrial output growth");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/indicators.test.ts`
Expected: FAIL — cannot resolve `./indicators`.

- [ ] **Step 3: Implement `web/lib/news-desk/indicators.ts`**

```ts
import { z } from "zod";
import { callTool } from "./mospi";
import { toSeries, type Point } from "./series";
import type { IndicatorDef, IndicatorValue } from "./types";

// MoSPI rejects a larger limit.
const PAGE_SIZE = "100";
// A matched definition pages until it holds two points. The previous month's
// CPI food row was on page 3 on 2026-09-26; four pages leave one spare, and at
// 10 s per call stay inside the refresh route's 60 s.
const MAX_PAGES = 4;

const dataSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  meta_data: z.object({ totalPages: z.number() }).partial().optional(),
});

function matches(row: Record<string, unknown>, match: Record<string, string> | undefined): boolean {
  if (!match) return true;
  return Object.entries(match).every(([field, value]) => String(row[field]) === value);
}

/** The definition's series, oldest first. Throws when MoSPI fails or has no values. */
export async function fetchSeries(def: IndicatorDef): Promise<Point[]> {
  const rows: Record<string, unknown>[] = [];
  let points: Point[] = [];
  for (let page = 1; page <= (def.match ? MAX_PAGES : 1); page++) {
    const response = dataSchema.parse(
      await callTool("get_data", {
        dataset: def.dataset,
        filters: { ...def.filters, limit: PAGE_SIZE, page: String(page) },
      }),
    );
    rows.push(...response.data.filter((row) => matches(row, def.match)));
    const series = toSeries(rows, def.valueField);
    if (!series.ok) throw new Error(series.reason);
    points = series.points;
    const lastPage = response.meta_data?.totalPages ?? page;
    if (points.length >= 2 || page >= lastPage) break;
  }
  if (points.length === 0) throw new Error("MoSPI returned no values for these filters");
  return points;
}

/** One value per definition, in order. Never throws: a failed query keeps the
 * previous values with `error` set and `lastGoodAt` unchanged (spec §6.4). */
export async function refreshIndicators(
  defs: IndicatorDef[],
  previous: IndicatorValue[],
  now: Date,
): Promise<IndicatorValue[]> {
  return Promise.all(
    defs.map(async (def): Promise<IndicatorValue> => {
      const base = { id: def.id, label: def.label, unit: def.unit };
      try {
        const points = await fetchSeries(def);
        const latest = points[points.length - 1];
        const prior = points.length > 1 ? points[points.length - 2] : undefined;
        return {
          ...base,
          period: latest.period,
          latest: latest.value,
          prevPeriod: prior?.period ?? null,
          prev: prior?.value ?? null,
          lastGoodAt: now.toISOString(),
        };
      } catch (err) {
        console.error(`news-desk: indicator ${def.id} failed`, err);
        const before = previous.find((p) => p.id === def.id);
        return {
          ...base,
          period: before?.period ?? null,
          latest: before?.latest ?? null,
          prevPeriod: before?.prevPeriod ?? null,
          prev: before?.prev ?? null,
          lastGoodAt: before?.lastGoodAt ?? null,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        };
      }
    }),
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/indicators.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/indicators.ts web/lib/news-desk/indicators.test.ts
git commit -m "feat(news-desk): refresh MoSPI indicators, keeping last good values on failure

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: Indicators in the refresh

**Files:**
- Modify: `web/lib/news-desk/refresh.ts`, `web/app/api/news-desk/refresh/route.ts` (comment only)
- Test: `web/lib/news-desk/refresh.test.ts`

**Interfaces:**
- Consumes: `refreshIndicators` (Task 4), `readIndicatorDefs` (Task 3).
- Produces: `runRefresh(now?)` unchanged in signature; the saved snapshot carries `indicators`.

Spec §9 lists indicators after tagging. They do not depend on headlines, and run concurrently here: sequentially, feeds (8 s) + tagging (40 s) + indicators (up to 40 s for the paged food row) would exceed the route's 60 s.

- [ ] **Step 1: Write the failing tests**

In `web/lib/news-desk/refresh.test.ts`:
- Add `vi.mock("./indicators", () => ({ refreshIndicators: vi.fn() }));` next to the other mocks, and add `readIndicatorDefs: vi.fn()` to the object the `./store` mock returns.
- Import `refreshIndicators` from `./indicators`, `readIndicatorDefs` from `./store`, `DEFAULT_INDICATORS` from `./defaults`, and `IndicatorValue` from `./types`.
- At the end of `beforeEach`:

```ts
    vi.mocked(readIndicatorDefs).mockResolvedValue(DEFAULT_INDICATORS);
    vi.mocked(refreshIndicators).mockResolvedValue([]);
```

Add:

```ts
  it("saves refreshed indicators, passing the previous values in", async () => {
    const before: IndicatorValue = {
      id: "iip",
      label: "IIP growth",
      unit: "%",
      period: "Jun 2026",
      latest: 8.8,
      prevPeriod: "May 2026",
      prev: 5,
      lastGoodAt: "2026-09-20T08:00:00.000Z",
    };
    const after: IndicatorValue = { ...before, period: "Jul 2026", latest: 6.7, prevPeriod: "Jun 2026", prev: 8.8 };
    vi.mocked(readSnapshot).mockResolvedValue({
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [],
      indicators: [before],
      sourceErrors: [],
    });
    vi.mocked(refreshIndicators).mockResolvedValue([after]);

    const result = await runRefresh(NOW);

    expect(refreshIndicators).toHaveBeenCalledWith(DEFAULT_INDICATORS, [before], NOW);
    expect(result.indicators).toEqual([after]);
    expect(writeSnapshot).toHaveBeenCalledWith(result);
  });

  it("starts the indicators without waiting for the feeds", async () => {
    let releaseFeeds!: () => void;
    vi.mocked(fetchAllFeeds).mockReturnValue(
      new Promise((resolve) => (releaseFeeds = () => resolve({ headlines: [fresh], errors: [] }))),
    );
    vi.mocked(readSnapshot).mockResolvedValue(null);

    const done = runRefresh(NOW);
    await vi.waitFor(() => expect(refreshIndicators).toHaveBeenCalled());
    releaseFeeds();
    await done;
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/refresh.test.ts`
Expected: FAIL — `refreshIndicators` is never called.

- [ ] **Step 3: Implement**

Rewrite `web/lib/news-desk/refresh.ts` below the imports (add imports for `refreshIndicators` from `./indicators`, `readIndicatorDefs` from `./store`, and `SourceError` from `./types`):

```ts
export async function runRefresh(now: Date = new Date()): Promise<Snapshot> {
  // Read before fetching: if S3 is unreachable there is no point spending the
  // feed round-trips, and nothing must be written over a snapshot we could not read.
  let previous: Snapshot | null = null;
  try {
    previous = await readSnapshot();
  } catch (err) {
    // A corrupt file would otherwise fail every refresh until someone deleted it
    // by hand. Replacing it loses at most 14 days of headlines the feeds still carry.
    if (!(err instanceof SnapshotCorruptError)) throw err;
    console.error("news-desk: replacing a corrupt snapshot", err);
  }
  const defs = await readIndicatorDefs();

  // Indicators do not depend on the headlines, so they run alongside the
  // feed-and-tag chain; one after the other would not fit the route's 60 s.
  const [{ headlines, sourceErrors }, indicators] = await Promise.all([
    refreshHeadlines(previous?.headlines ?? [], now),
    refreshIndicators(defs, previous?.indicators ?? [], now),
  ]);

  const snapshot: Snapshot = {
    version: 1,
    refreshedAt: now.toISOString(),
    headlines,
    indicators,
    sourceErrors,
  };
  await writeSnapshot(snapshot);
  return snapshot;
}

async function refreshHeadlines(
  existing: Headline[],
  now: Date,
): Promise<{ headlines: Headline[]; sourceErrors: SourceError[] }> {
  const { headlines, errors } = await fetchAllFeeds();
  // Merge first so a story carried by two sources is tagged once. Everything still
  // Untagged is sent: new items, and items whose chunk failed last time.
  const merged = mergeHeadlines(existing, headlines, now);
  const tagging = await tagHeadlines(merged.filter((h) => h.tag === "Untagged"));
  if (tagging.calls > 0) {
    console.log(
      `news-desk: tagged ${tagging.tags.size} headlines in ${tagging.calls} calls ` +
        `(${tagging.failedCalls} failed), $${tagging.costUsd.toFixed(4)}`,
    );
  }
  return {
    headlines: merged.map((h) => {
      const tag = tagging.tags.get(h.id);
      return tag ? { ...h, tag } : h;
    }),
    sourceErrors: errors,
  };
}
```

In `web/app/api/news-desk/refresh/route.ts`, extend the `maxDuration` comment: MoSPI indicators run in the same request, alongside the feeds and tagging, 10 s per call.

- [ ] **Step 4: Run all news-desk tests and the type check**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk app/api/news-desk && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/lib/news-desk/refresh.ts web/lib/news-desk/refresh.test.ts web/app/api/news-desk/refresh/route.ts
git commit -m "feat(news-desk): refresh indicators alongside headlines

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: Indicator table and two-column layout

**Files:**
- Create: `web/components/news-desk/IndicatorTable.tsx`, `web/components/news-desk/IndicatorTable.test.tsx`, `web/components/news-desk/IndicatorTable.stories.tsx`
- Modify: `web/components/news-desk/NewsDesk.tsx`, `web/components/news-desk/NewsDesk.test.tsx`, `web/app/tools/news-desk/page.tsx`

**Interfaces:**
- Consumes: `IndicatorValue` (Task 3), `formatAge` from `lib/news-desk/format`.
- Produces: `IndicatorTable({ indicators, now }: { indicators: IndicatorValue[]; now: Date })`.

- [ ] **Step 1: Write the failing tests**

`web/components/news-desk/IndicatorTable.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IndicatorTable } from "./IndicatorTable";
import type { IndicatorValue } from "../../lib/news-desk/types";

const NOW = new Date("2026-09-26T12:00:00.000Z");

const fresh: IndicatorValue = {
  id: "cpi-headline",
  label: "Retail inflation",
  unit: "%",
  period: "Aug 2026",
  latest: 4.82,
  prevPeriod: "Jul 2026",
  prev: 4.45,
  lastGoodAt: "2026-09-26T11:00:00.000Z",
};

describe("IndicatorTable", () => {
  it("shows each indicator's period, latest and previous value", () => {
    render(<IndicatorTable indicators={[fresh]} now={NOW} />);
    const table = screen.getByRole("table", { name: "Official indicators" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Indicator",
      "Period",
      "Latest",
      "Prev",
    ]);
    const [, row] = within(table).getAllByRole("row");
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Retail inflation",
      "Aug 2026",
      "4.82%",
      "4.45%",
    ]);
    expect(within(row).getByText("4.45%")).toHaveAttribute("title", "Jul 2026");
  });

  it("marks a row whose last refresh failed, keeping its last good value", () => {
    render(
      <IndicatorTable indicators={[{ ...fresh, error: "MoSPI status 503" }]} now={NOW} />,
    );
    expect(screen.getByText("4.82%")).toBeInTheDocument();
    expect(screen.getByText("stale")).toHaveAttribute(
      "title",
      "Stale since 1h ago. The last refresh failed: MoSPI status 503",
    );
  });

  it("shows a dash for an indicator that has never loaded", () => {
    const never: IndicatorValue = {
      ...fresh,
      period: null,
      latest: null,
      prevPeriod: null,
      prev: null,
      lastGoodAt: null,
      error: "MoSPI rejected the query: Invalid parameters",
    };
    render(<IndicatorTable indicators={[never]} now={NOW} />);
    const [, row] = screen.getAllByRole("row");
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "Retail inflationnot loaded",
      "—",
      "—",
      "—",
    ]);
    expect(screen.getByText("not loaded")).toHaveAttribute(
      "title",
      "Not loaded yet: MoSPI rejected the query: Invalid parameters",
    );
  });

  it("says when there are no indicators yet", () => {
    render(<IndicatorTable indicators={[]} now={NOW} />);
    expect(screen.getByText("Indicators load on the next Refresh.")).toBeInTheDocument();
  });
});
```

In `web/components/news-desk/NewsDesk.test.tsx`, give `SNAPSHOT` one indicator (replacing `indicators: []` from Task 3):

```ts
  indicators: [
    {
      id: "cpi-headline",
      label: "Retail inflation",
      unit: "%",
      period: "Aug 2026",
      latest: 4.82,
      prevPeriod: "Jul 2026",
      prev: 4.45,
      lastGoodAt: "2026-09-25T10:00:00.000Z",
    },
  ],
```

and add:

```tsx
  it("shows the indicator table beside the headlines", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    expect(within(screen.getByRole("table", { name: "Official indicators" })).getByText("4.82%")).toBeInTheDocument();
  });

  it("updates the indicators when a refresh returns new ones", async () => {
    const next = {
      ...SNAPSHOT,
      indicators: [{ ...SNAPSHOT.indicators[0], period: "Sep 2026", latest: 5.1, prevPeriod: "Aug 2026", prev: 4.82 }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(next), { status: 200 })));
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText("5.1%")).toBeInTheDocument());
  });

  it("shows the empty indicator table before the first refresh", () => {
    render(<NewsDesk initial={null} problem={null} nowIso={NOW} />);
    expect(screen.getByText("Indicators load on the next Refresh.")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run components/news-desk`
Expected: FAIL — `./IndicatorTable` does not exist; no table in `NewsDesk`.

- [ ] **Step 3: Implement**

`web/components/news-desk/IndicatorTable.tsx`:

```tsx
import { formatAge } from "../../lib/news-desk/format";
import type { IndicatorValue } from "../../lib/news-desk/types";

function show(value: number | null, unit: string): string {
  // As MoSPI publishes it: CPI to two decimals, the rest to one.
  return value === null ? "—" : `${value}${unit}`;
}

export function IndicatorTable({ indicators, now }: { indicators: IndicatorValue[]; now: Date }) {
  if (indicators.length === 0) {
    return <p className="text-sm text-muted">Indicators load on the next Refresh.</p>;
  }
  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
        Official indicators
      </caption>
      <thead>
        <tr className="border-b border-rule text-left text-xs text-muted">
          <th scope="col" className="py-2 font-normal">Indicator</th>
          <th scope="col" className="py-2 font-normal">Period</th>
          <th scope="col" className="py-2 text-right font-normal">Latest</th>
          <th scope="col" className="py-2 text-right font-normal">Prev</th>
        </tr>
      </thead>
      <tbody>
        {indicators.map((row) => (
          <tr key={row.id} className="border-b border-rule align-top">
            <td className="py-2 pr-2 text-fg">
              {row.label}
              {row.error && (
                <span
                  className="ml-1.5 text-[0.6875rem] uppercase tracking-[0.12em] text-accent"
                  title={
                    row.lastGoodAt
                      ? `Stale since ${formatAge(row.lastGoodAt, now)}. The last refresh failed: ${row.error}`
                      : `Not loaded yet: ${row.error}`
                  }
                >
                  {row.lastGoodAt ? "stale" : "not loaded"}
                </span>
              )}
            </td>
            <td className="py-2 pr-2 text-muted">{row.period ?? "—"}</td>
            <td className="py-2 text-right text-fg">{show(row.latest, row.unit)}</td>
            <td className="py-2 text-right text-muted" title={row.prevPeriod ?? undefined}>
              {show(row.prev, row.unit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

The table's accessible name comes from its `<caption>`.

`web/components/news-desk/NewsDesk.tsx`: import `IndicatorTable`, and wrap everything after the refresh bar and error alert in a grid, with the table first in the DOM so it comes first on narrow screens:

```tsx
      <div className="mt-6 grid grid-cols-12 gap-x-10 gap-y-8">
        {/* First in the DOM so narrow screens show it above the headlines (spec §4). */}
        <aside className="col-span-12 lg:order-2 lg:col-span-4">
          {/* Sticky and vertically centred beside the scrolling headlines. */}
          <div className="lg:sticky lg:top-1/2 lg:-translate-y-1/2">
            <IndicatorTable indicators={snapshot?.indicators ?? []} now={now} />
          </div>
        </aside>
        <div className="col-span-12 lg:order-1 lg:col-span-8">
          {/* the existing problem / tabs / headline-list conditional, unchanged */}
        </div>
      </div>
```

Remove the `mt-6` / `mt-4` top margins from the elements that are now the first child of the headline column (the problem `<p>`, the tab group `<div>`, and the empty-state `<p>`), since the grid supplies the gap.

`web/app/tools/news-desk/page.tsx`: the NewsDesk now needs the full width. Change the content column from `col-span-12 lg:col-span-8` to `col-span-12`, and wrap the `<p>` intro in `<div className="lg:w-2/3">` so its line length stays as it was.

`web/components/news-desk/IndicatorTable.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IndicatorTable } from "./IndicatorTable";
import type { IndicatorValue } from "../../lib/news-desk/types";

const meta = {
  title: "News Desk/IndicatorTable",
  component: IndicatorTable,
} satisfies Meta<typeof IndicatorTable>;

export default meta;
type Story = StoryObj<typeof meta>;

const indicators: IndicatorValue[] = [
  {
    id: "cpi-headline",
    label: "Retail inflation",
    unit: "%",
    period: "Aug 2026",
    latest: 4.82,
    prevPeriod: "Jul 2026",
    prev: 4.45,
    lastGoodAt: "2026-09-26T11:00:00.000Z",
  },
  {
    id: "iip",
    label: "IIP growth",
    unit: "%",
    period: "Jul 2026",
    latest: 6.7,
    prevPeriod: "Jun 2026",
    prev: 8.8,
    lastGoodAt: "2026-09-20T11:00:00.000Z",
    error: "MoSPI status 503",
  },
  {
    id: "gdp",
    label: "GDP growth (real)",
    unit: "%",
    period: null,
    latest: null,
    prevPeriod: null,
    prev: null,
    lastGoodAt: null,
    error: "MoSPI rejected the query: Invalid parameters",
  },
];

export const Default: Story = {
  args: { indicators, now: new Date("2026-09-26T12:00:00.000Z") },
};

export const Empty: Story = {
  args: { indicators: [], now: new Date("2026-09-26T12:00:00.000Z") },
};
```

- [ ] **Step 4: Run tests, lint and type check**

Run: `cd /e/Personal/looper/web && npx vitest run components/news-desk && npm run lint && npx tsc --noEmit`
Expected: PASS, no lint or type errors.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/components/news-desk web/app/tools/news-desk
git commit -m "feat(news-desk): indicator table beside the headlines

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 7: Measure, update docs, open the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-news-desk-design.md` (§4, §6.1, §6.3, §6.4, §9, §15), `CHANGELOG.md`, epic #253 body

- [ ] **Step 1: Full local gate**

Run: `cd /e/Personal/looper/web && npm test && npm run lint && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build && npm run test:e2e`
Expected: all green. Run nothing else heavy at the same time: the full e2e run times out on `page.goto` under load. Rerun any timed-out spec on its own and report both runs.

- [ ] **Step 2: Measure a real refresh against the dev bucket**

This writes `news-desk/snapshot.json` in the dev bucket, as pressing Refresh on the dev deployment does.

```bash
cd /e/Personal/looper/web && \
  OPENROUTER_API_KEY="$(grep openrouter_api_key ../infra/main/terraform.tfvars | cut -d'"' -f2)" \
  OPENROUTER_BASE_URL=https://openrouter.ai/api/v1 NEWS_DESK_MODEL=anthropic/claude-haiku-4.5 \
  S3_BUCKET_NAME=bgm-looper-audio-dev-223376380711 APP_AWS_REGION=us-east-1 AWS_PROFILE=personal \
  APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev
```

Log in (`POST /api/login` with `{"password":"test123"}`, keep the cookie) and `POST /api/news-desk/refresh`. Record the total time and confirm the five indicator rows have values and no `error`. Stop the server and `git checkout web/next-env.d.ts` if `next dev` touched it. Open `http://localhost:3000/tools/news-desk` once while it runs, at desktop and phone width, to check the table sits beside the headlines on desktop and above them on a phone.

- [ ] **Step 3: Update the spec**

- §4: the right column is the indicator table; no change unless the layout differs from the text.
- §6.1: add that `limit` is capped at 100, and that any content object with an `error` key is a failure (both shapes, quoted).
- §6.3: replace the defaults table with the five verified rows from this plan's Global Constraints table (dataset, filters, valueField), add the optional `match` field to the definition shape, and note that ISP has no headline index so services growth is not a default. Note that PLFS uses the monthly series and why.
- §6.4: a null value drops the point; two rows for one period make the series invalid; a matched definition pages up to 4 times.
- §9: indicators run alongside the feed-and-tag chain, not after it; record the measured refresh time.
- §15: close the "filter codes for the five unverified default indicators" item.

- [ ] **Step 4: CHANGELOG**

Under `## [Unreleased]` → `### Added`, edit the first News Desk bullet's last sentence to "The chat assistant follows in a later phase (#253)." and add:

```md
- News Desk indicators: a table of official MoSPI figures beside the headlines (retail inflation, food and beverages inflation, IIP growth, real GDP growth and urban unemployment), with the latest and previous values. Refresh updates them along with the headlines; a figure that fails to refresh keeps its last value and is marked stale (#253).
```

- [ ] **Step 5: Commit, push, PR**

```bash
cd /e/Personal/looper && git add docs CHANGELOG.md && git commit -m "docs(news-desk): verified MoSPI defaults and measured refresh time

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/news-desk-phase-3
gh pr create --base dev --title "feat: News Desk Phase 3 — MoSPI indicators" --body "…"
```

PR body: what changed (client, series, indicators, refresh, table), the deviations from spec §6.3 and why (series=Current, match and paging, PLFS monthly, no ISP default, concurrency), the measured refresh time, test evidence, no infra change, and `Closes #<N>`. Update the epic's Phase 3 line if it names the six defaults. Then follow the `merging-a-pr` skill; do not merge without it.

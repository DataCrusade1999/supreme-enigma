# News Desk — Design

**Date:** 2026-09-25
**Status:** Approved 2026-09-25
**Branch:** `feat/news-desk-phase-1` (Phase 1 carries this spec)
**Epic:** #253

## 1. Problem

The owner wants one place to follow news on the Indian economy, economic reforms and legislation, drawn from wire services and financial papers (Reuters, Bloomberg, FT, The Economist), plus the official numbers behind those stories. None of those publishers offer free full text, and Reuters and Bloomberg have no public RSS. MoSPI (the Ministry of Statistics) publishes official statistics through a public MCP server, `https://mcp.mospi.gov.in/`, which an LLM can query in plain English.

## 2. Goals and non-goals

Goals:

- A gated tool at `/tools/news-desk` listing recent headlines, each tagged Economy, Reforms or Legislation.
- A table of official MoSPI indicators beside the headlines.
- A chat assistant that answers statistics questions from MoSPI data, draws a chart when the answer is a time series, and can pin that series into the indicator table.
- Refresh happens only when the owner clicks Refresh. Nothing runs on a schedule.
- Free sources only. LLM cost stays in single-digit rupees per action.

Non-goals:

- Full article text. Headlines link out to the publisher.
- Read/unread state, search, or history beyond 14 days.
- Follow-up questions in chat. Each question is answered on its own (§7.1).
- Charts in the indicator table. Charts appear only in chat answers.
- Any scheduled job, email digest or notification.

## 3. Decisions

| # | Decision | Rejected alternative, and why |
|---|---|---|
| D1 | Refresh is manual; the result is stored in S3 | Fetch on page load: every visit would re-run feeds and paid tagging |
| D2 | Topic tagging by LLM (Haiku 4.5 via OpenRouter), new headlines only | Keyword rules: cheaper but mislabels; source-based: too coarse |
| D3 | Storage in each branch's existing S3 bucket, `news-desk/` prefix | Vercel Blob: new service and dependency when S3 already works here |
| D4 | Chat answers one question at a time, no model-side memory | Follow-ups: every turn re-sends the conversation; can be added later in the client only |
| D5 | Indicators are added by pinning a chat answer | An "add indicator" form: MoSPI filter lists are long and awkward as dropdowns |
| D6 | Chat streams progress events (NDJSON) | Plain request/response: slower-feeling, and a failure gives no clue where it stopped |
| D7 | MoSPI MCP called with hand-written JSON-RPC over `fetch` | `@modelcontextprotocol/sdk`: the server is stateless and has four tools; ~50 lines replace a dependency |
| D8 | Hand-written SVG line chart | A chart library: one chart type in one place does not justify the bundle |
| D9 | Own model env var `NEWS_DESK_MODEL` | Reusing `OPENROUTER_MODEL`: changing the resume model would silently change this tool |
| D10 | Indicator rows show only the current series of each dataset | Splicing base years: CPI base 2012 and base 2024 differ in field names and even state codes (§6.2) |
| D11 | RSS parsed with `fast-xml-parser` 4 | Regex parsing: CDATA, entities and namespaced tags vary across these 13 feeds. v4 has one small dependency (`strnum`); v5 is a rewrite with six |

## 4. Page

Route: `/tools/news-desk`. It is gated because everything under `/tools` is (`web/lib/route-gate.ts`). Registration:

- one entry in `TOOLS` with a new kind, `News` (the existing kinds are Audio, Site and Money, none of which fit),
- one `open news-desk` row in `web/lib/site/commands.ts`,
- `/api/news-desk` added to `GATED_PREFIXES`, since API prefixes are listed explicitly.

Layout (desktop), agreed from mockup v4 during brainstorming:

- Top bar: title, "Refreshed 2h ago · N sources failed" (the failure count expands to the list), and a Refresh button. The button is disabled while a refresh is running.
- Left column, about 70% wide: topic tabs with counts (All, Economy, Reforms, Legislation, Hidden), then headlines newest first. Each headline shows its tag, title (linking to the article, new tab), the feed's summary when present, and source and age on their own line.
- Right column, about 30% wide: the indicator table (Indicator, Period, Latest, Prev), sticky and vertically centred in the viewport as the headlines scroll. Pinned rows appear here with a remove control. A row whose last refresh failed shows its last good value and "stale since …" on hover.
- A floating "Ask MoSPI" button, bottom right, opening a chat panel (§7).

On narrow screens the columns stack: indicator table first, then headlines.

## 5. Headlines

### 5.1 Sources

Checked on 2026-09-25 from a plain HTTP client:

| Source | How | Result |
|---|---|---|
| FT India | `https://www.ft.com/world/asia-pacific/india?format=rss` | 200, 25 items |
| RBI press releases | `https://www.rbi.org.in/pressreleases_rss.xml` | 200, 10 items |
| RBI notifications | `https://www.rbi.org.in/notifications_rss.xml` | 200, 10 items |
| SEBI | `https://www.sebi.gov.in/sebirss.xml` | 200, 30 items |
| PIB | `https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3` | 200, but items are in Hindi whatever `Lang` is set to, and carry no `pubDate`. **Use Google News** (`site:pib.gov.in`) |
| Mint Economy | `https://www.livemint.com/rss/economy` | 200, 35 items |
| Business Standard Economy | `https://www.business-standard.com/rss/economy-102.rss` | 200, 35 items |
| The Economist | `economist.com/<section>/rss.xml` | **403** — use Google News |
| PRS Legislative Research | no RSS found (`/rss.xml`, `/billtrack/rss` both 404) | use Google News |
| Reuters, Bloomberg | no public RSS | use Google News |

Google News queries use `https://news.google.com/rss/search?q=<query>&hl=en-IN&gl=IN&ceid=IN:en`, each with `when:7d` so they return recent items rather than the archive (an unrestricted `site:prsindia.org` query returned a 2021 Act first, because Google News sorts by relevance). With `when:7d` the same query returned only items from the last seven days (checked 2026-09-25); `site:economist.com` still returned 17 older items, which the age filter in §5.2 removes. Queries:

- `site:reuters.com India economy`
- `site:pib.gov.in (Cabinet OR economy OR bill OR GDP OR inflation OR GST OR reform OR RBI)` (unfiltered, PIB fills the 100-item cap with unrelated ministry notices)
- `site:bloomberg.com India`
- `site:economist.com India`
- `site:prsindia.org`
- `India (bill OR ordinance OR amendment) (Lok Sabha OR Rajya Sabha)`
- `India ("Cabinet approves" OR "GST Council" OR "labour codes" OR disinvestment OR reform)`

The source list is a constant in `feeds.ts`. Changing it is a code change.

### 5.2 Normalization and dedupe

Every item becomes `{id, title, url, source, summary?, publishedAt}`. `id` is a hash of the normalized title plus the UTC publish day. The day is part of the key because some releases repeat a fixed title: RBI publishes "Government Stock - Auction Results: Cut-off" every week, and a title-only key would keep the first week's copy and drop every later one until it aged out. Google News sometimes stamps its own index time instead of the publisher's, which can put two copies of one story on different UTC days, so the merge also treats same-title items less than 12 hours apart as one story. A daily release with a fixed title is about 24 hours apart and stays separate.

Items older than 14 days, or with no parseable date, are discarded immediately after parsing, before dedupe and tagging, so the model is never paid to tag an old item.

Dates are not uniform. RBI publishes `Fri, 25 Sep 2026 14:05:00` with no time zone (it is IST; parsed bare, it would be read as UTC on Vercel and be 5.5 hours off), and SEBI publishes `24 Sep, 2026 +0530`, which `Date.parse` rejects. A date with no zone gets `+0530` appended, and the comma after the month is removed before parsing.

Only FT, Mint and Business Standard summaries are kept. RBI's `description` is an HTML table and SEBI's repeats the title.

Google News items name the publisher in a `<source>` element and repeat it as a ` - <Publisher>` title suffix. `<source>` becomes `source` and the matching suffix is stripped; the suffix is only used as a fallback when `<source>` is missing, since headlines themselves contain " - ". Google News links are `news.google.com/rss/articles/…` redirects, so they never match the publisher's own URL; dedupe is therefore by normalized title (lowercased, punctuation and the publisher suffix removed, whitespace collapsed). When two items share a normalized title, the one from a direct feed wins, because its link goes straight to the article.

Summaries are the feed's own `description`, stripped of HTML and cut to about 200 characters. Google News descriptions are just the title again and are dropped.

### 5.3 Tagging

After the merge, every headline still tagged `Untagged` is sent: new items, and items whose chunk failed on an earlier refresh. They are split into chunks of 100 and the chunks are sent in parallel. Each call sends `[{n, title, source}]`, where `n` is the item's position in the chunk (short, so output stays small), with `response_format` strict JSON returning `[{n, tag}]`, `tag ∈ Economy | Reforms | Legislation | Drop`.

Chunking matters on the first refresh, when every headline is new: about 600 items in one call would need roughly 12,000 output tokens, which would exceed the output cap and take longer than the route's 60 s. Truncated JSON would save everything as `Untagged`, and the retry on the next refresh would fail the same way. At 100 per chunk, each call needs about 1,500 output tokens. `Drop` hides off-topic items (PIB congratulating athletes, for example). They stay in the snapshot with that tag so the next refresh does not tag them again while they are still in the feeds. The page lists them under a Hidden tab, so a real story the model got wrong can still be found. The prompt defines each tag in one or two sentences: Legislation covers bills, Acts, ordinances, amendments and committee reports; Reforms covers policy and regulatory changes by government, RBI, SEBI or the GST Council; Economy is everything else about the Indian economy.

If a chunk's call fails or returns invalid JSON, that chunk's items are saved with tag `Untagged`; other chunks are unaffected. Untagged items appear only under All, and the next refresh retries them because they are not yet tagged. `max_tokens` is 3,000 per chunk.

## 6. Indicators

### 6.1 MoSPI MCP client

Verified on 2026-09-25: the server needs no API key and no session. A `tools/call` POST works without `initialize` first, and returns `text/event-stream` with a single `data:` line holding the JSON-RPC response. A `get_data` call took about 200 ms.

`mospi.ts` exposes `callTool(name, args)`: POST with `Accept: application/json, text/event-stream`, read the body, take the `data:` line, parse it, return `result.content[0].text` parsed as JSON. A JSON-RPC error, a `result.isError`, or a content object with an `error` key all throw. MoSPI reports a rejected query inside a successful response in two shapes: `{"error": …, "valid": false, "missing_required": […]}` for invalid filters, and `{"error": "An error occurred: 400 …", "troubleshooting": …}` when its upstream API rejects the query. Timeout 10 s.

`limit` is capped at 100: 200 and 500 return the upstream-400 shape (found 2026-09-26). Every `get_data` call sends `limit: "100"` and a `page`.

Tools: `list_datasets`, `get_indicators(dataset)`, `get_metadata(dataset, …)`, `get_data(dataset, filters)`. All filters, including `limit` and `page`, go inside `filters`.

### 6.2 Base-year breaks

MoSPI moves datasets to new base years, and the series are not directly comparable. CPI moved to base 2024 in January 2026: base 2024 returns Jan–Aug 2026 with fields `division`, `index`, `inflation`, and `state_code=1` is All India; base 2012 returns up to Dec 2025 with fields `baseyear`, `group`, `subgroup`, and `state_code=1` is Jammu & Kashmir. NAS similarly accepts `base_year` `2022-23` or `2011-12`.

Each indicator therefore stores one query against one base year. The table shows the latest two values of that series. Splicing is out of scope (D10). When a dataset rebases, the default indicator definition is updated in code and pinned ones are re-pinned by hand.

### 6.3 Indicator definitions

`news-desk/indicators.json` holds `[{id, label, dataset, filters, valueField, unit, match?}]`. When it is absent the defaults below are used; Phase 4's pin and unpin are its only writers. `match` lists row fields that must equal given values, for datasets whose filters cannot narrow the response to one series.

Defaults, verified against MoSPI on 2026-09-26 and pinned by fixture tests against responses recorded that day:

| Label | Dataset | Filters | valueField |
|---|---|---|---|
| Retail inflation | CPI | `base_year=2024, series=Current, state_code=1, sector_code=3, division_code=0` | `inflation` |
| Food and beverages inflation | CPI | same, `division_code=1`; `match: {code: "01"}` | `inflation` |
| IIP growth | IIP | `base_year=2022-23, frequency=Monthly, type=General` | `growth_rate` |
| GDP growth (real) | NAS | `base_year=2022-23, series=Current, frequency_code=Quarterly, indicator_code=22` | `constant_price` |
| Unemployment (urban) | PLFS | `indicator_code=3, frequency_code=3, state_code=99, gender_code=3, age_code=1, sector_code=2` | `value` |

- CPI requires `series=Current`; without it MoSPI answers `missing_required: ["series"]`.
- A base-2024 CPI division returns every group, class and sub-class row beneath it (219 rows a month for food), and `group_code` and `class_code` are rejected in base 2024. The food definition therefore matches the division's own row (`code=01`) and pages through the results (§6.4).
- NAS indicator 22 is the GDP growth rate; `constant_price` is real growth, so no year-on-year computation is needed.
- PLFS uses the monthly series (`frequency_code=3`), which starts in 2025, is current weekly status by construction and runs to the latest month. The quarterly series (`frequency_code=2`) ends at Oct–Dec 2025 and labels its years inconsistently.
- Services growth (ISP) is not a default: MoSPI publishes no headline ISP index. `type_code=1` (General) returns no rows; only 19 sub-sectors exist.

### 6.4 Rows to values

`series.ts` turns `get_data` rows into `[{period, value}]` sorted by time. It recognizes calendar year + month name, fiscal year + month name (April–December in the first year, January–March in the second), fiscal year + quarter (`Q1`–`Q4`), and a bare fiscal year (`2025-26`). A row whose value is null is skipped: base-2024 CPI returns 2025 months with an index but no inflation figure. Two rows for one period make the series invalid, since the filters then match more than one series and either number could be the wrong one. Rows it cannot place in time also make the series invalid, which is what makes a chat answer unpinnable (§7.3). The same function serves the table (last two points) and chat charts (all points), so a pinned row always matches the chart it came from.

A definition with `match` pages through `get_data` (100 rows a page) until it holds two points or reaches the last page, at most 4 pages; the previous month's food row was on page 3 on 2026-09-26. A definition without `match` makes one call.

A refresh runs every indicator query in parallel. A failed query keeps the previous values and sets `error` and leaves `lastGoodAt` unchanged.

## 7. Chat assistant

### 7.1 Interaction

The panel keeps the questions and answers from the current tab visible, so the owner can scroll back and pin. Each question is sent to the model on its own; nothing earlier is included. The input placeholder says "Each question is answered on its own."

### 7.2 Loop

`POST /api/news-desk/ask` with `{question}`. `ask.ts` is an async generator yielding events; the route turns it into an NDJSON `ReadableStream` and sets `maxDuration = 60`.

1. System prompt: answer only about Indian official statistics; call the tools in order `list_datasets` → `get_indicators` → `get_metadata` → `get_data`; prefer the latest base year; state only numbers that appear in tool results.
2. The four MoSPI tools are offered as OpenRouter tool definitions. Each tool call the model makes is sent to `mospi.ts`, and a `{"type":"step","label":…}` event is yielded with a plain-English label derived from the tool name and dataset ("Reading CPI filters…").
3. **Metadata compaction.** `get_metadata` results can be large (CPI base 2024 returned 82 KB). Before a result goes back to the model it is rewritten compactly: each filter list becomes `name: code=label, code=label, …`, and fields the model does not need (`viz`) are removed. No filter values are removed. A result still over 20,000 characters is truncated with a note telling the model to query a narrower level.
4. **Ending the loop.** A fifth tool, `answer`, takes `{text, chart: null | {title, unit, dataset, filters, valueField}}`. The loop ends when the model calls it. This avoids having to know in advance which turn is the last one, and avoids combining `response_format` with tools, which OpenRouter does not reliably support for Anthropic models. If the model replies with plain text instead of calling a tool, it is sent back once with an instruction to call `answer`; a second plain reply ends in an `error` event.
5. Limits: 8 MoSPI tool calls, 1,500 output tokens per turn, about 120,000 input tokens across the loop. When the 8th MoSPI call returns, or the input budget is reached, the next request sets `tool_choice` to `answer`, so the model must answer with what it has. Hitting a limit gives a best-effort answer, not an error.
6. If `chart` is set, the server re-runs that `get_data` call itself and builds points with `series.ts`. The model never supplies chart numbers. The final event is `{"type":"answer", text, chart: {title, unit, points} | null, pinnable, query}`.

Errors (MoSPI down, OpenRouter failure, the model refusing to call `answer`) yield `{"type":"error","message":…}` and end the stream. The client keeps the steps already shown.

### 7.3 Pinning

`pinnable` is true when the chart query re-ran and `series.ts` produced a valid series. The client shows a Pin button, and the label is editable before saving (default: chart title). `POST /api/news-desk/indicators` appends `{id, label, dataset, filters, valueField, unit}` to `indicators.json`; `DELETE /api/news-desk/indicators/:id` removes one. The new row is filled on the next Refresh.

## 8. Storage

Two objects per branch bucket, read and written by `store.ts`:

- `news-desk/indicators.json` — definitions (§6.3). Written only by pin and unpin.
- `news-desk/snapshot.json` — `{refreshedAt, headlines[], indicators[{id, period, latest, prevPeriod, prev, lastGoodAt, error?}], sourceErrors[{source, message}]}`. Headlines older than 14 days are dropped on each refresh.

Keeping definitions separate means a failed or bad refresh cannot lose pins.

Each write replaces the whole object. A second refresh started before the first finishes overwrites it, and the result is still a complete snapshot. The button is disabled while a refresh runs, so this only happens with two open tabs.

The bucket lifecycle deliberately has no catch-all expiry rule (`infra/main/environments.tf`), so these objects persist. Adding a blanket rule later would delete them along with `resume/current.*`.

## 9. Routes

| Route | Does |
|---|---|
| `POST /api/news-desk/refresh` | Feeds → dedupe → tag new, with indicators alongside that chain → save. `maxDuration = 60` |
| `POST /api/news-desk/ask` | NDJSON stream (§7.2). `maxDuration = 60` |
| `POST /api/news-desk/indicators` | Pin |
| `DELETE /api/news-desk/indicators/:id` | Unpin |

The page itself reads the snapshot on the server for the first render.

Indicators do not depend on the headlines, so the refresh runs them concurrently with the feed-and-tag chain. One after the other, feeds (8 s) + tagging (40 s cap) + a paged indicator (up to 4 calls of 10 s) could exceed 60 s. Measured on 2026-09-26 from a local `next dev` against the dev bucket: 10.4 s for a refresh that read 912 headlines, tagged 26 new ones in one call and loaded all five indicators.

## 10. Cost

Model `anthropic/claude-haiku-4.5` via OpenRouter at $1 / $5 per million input / output tokens, ₹96 per USD (2026-09-25).

| Action | Cost |
|---|---|
| First refresh (measured 2026-09-26: 886 headlines in 9 calls, $0.0735, 15.6 s) | ₹7.05 |
| Later refresh (new headlines only; about ₹0.008 per headline from the first-refresh figure, so ~100 new items is ~₹0.8; a refresh with nothing new makes no call) | ₹0–1 |
| Chat question (30–60k input tokens) | ₹3–6 |
| Indicator refresh | free |

The refresh rows were measured in Phase 2 at ₹95.92 per USD (2026-09-26); Phase 4 measures the chat row. The OpenRouter key has no spend limit that Terraform can set; the owner sets it in OpenRouter.

## 11. Infrastructure

One Terraform change, in Phase 1:

- The Vercel role's S3 policy in `infra/main/shared.tf` gains `s3:GetObject` and `s3:PutObject` on `news-desk/*` for all three bucket ARNs.
- It also gains `s3:ListBucket` on all three buckets. Without it, S3 answers a `GetObject` for a key that does not exist with 403 rather than 404, so the very first page load, before any snapshot exists, would look like a permissions outage. The existing `ResumeHeadObjectNotFound` statement grants the same thing on main's bucket for the same reason.
- New variable `news_desk_model` (default `anthropic/claude-haiku-4.5`) and Vercel env var `NEWS_DESK_MODEL` on all targets.

`terraform plan` against real state before merging, per repo rules.

## 12. Failure handling

| Failure | Behaviour |
|---|---|
| Feed timeout (8 s) or parse error | Skipped, listed in `sourceErrors`; other feeds still saved |
| Tagging call fails | New items saved as `Untagged`, retried next refresh |
| MoSPI down during refresh | Indicator keeps last good values, `error` set |
| MoSPI down, or model never calls `answer`, in chat | `error` event; earlier steps stay visible |
| Chat hits the tool-call or token limit | Forced `answer` call; best-effort answer |
| S3 read fails on page load | Error message on the page; nothing written |
| Concurrent refresh | Last write wins; each write is a whole snapshot |

## 13. Testing

Vitest, with fixtures recorded from the real services:

- RSS parsing for each feed shape, including Google News suffix stripping and summary cleanup.
- Dedupe, including direct-feed-wins.
- Tagger: request shape, applying tags, `Drop`, failure → `Untagged`. OpenRouter mocked.
- `mospi.ts`: SSE parsing, JSON-RPC error, `isError`, MoSPI's `{"valid": false}` body.
- `series.ts`: each period shape, sorting, unplaceable rows, CPI base 2012 vs 2024 fixtures.
- Metadata compaction: output smaller, no filter values lost, truncation note.
- `ask.ts`: event sequence for a scripted model; the 8-call limit forcing `answer` via `tool_choice`; a plain-text reply being re-prompted once, then erroring; chart points built by the server, not taken from the model.
- Tagger chunking: 250 items → 3 calls; one failed chunk leaves the other two tagged.
- Age filter: items older than 14 days or undated never reach the tagger.
- Routes: unauthenticated requests get 401; pin and unpin update `indicators.json`.

Playwright, one spec: page renders from a stubbed snapshot, tabs filter headlines, chat panel opens and closes. No live network in CI.

## 14. Phases

Each phase has its own issue, plan and PR into `dev`, and is usable on the dev deployment when merged.

1. **Infra, storage and feeds.** §11, `store.ts`, `feeds.ts`, dedupe, refresh route without tagging, page with the headline list, tool registration.
2. **Tagging.** `tagger.ts`, topic tabs, measured refresh cost.
3. **Indicators.** `mospi.ts`, `series.ts`, default definitions with verified filters, indicator table.
4. **Chat.** `ask.ts`, streaming route, chat panel, SVG chart, pinning, measured question cost.

## 15. Open items

- Whether Google News rate-limits six queries per refresh from Vercel's IPs. If it does, merge them into fewer queries.

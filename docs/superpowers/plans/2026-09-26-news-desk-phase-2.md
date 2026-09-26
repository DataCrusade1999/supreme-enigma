# News Desk Phase 2 (Topic tagging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each Refresh tags the headlines that are not yet tagged as Economy, Reforms, Legislation or Drop with Haiku 4.5 via OpenRouter, and the page gets topic tabs with counts.

**Architecture:** A new `web/lib/news-desk/tagger.ts` sends untagged headlines to OpenRouter in parallel chunks of 100 with strict JSON output, and returns a map of id → tag. `runRefresh` merges feeds into the stored headlines first, then tags every headline still marked `Untagged`, then saves. The headline schema gains a `tag` field that defaults to `Untagged`, so Phase 1 snapshots still read. `NewsDesk.tsx` filters by tab; `HeadlineList.tsx` shows each headline's tag.

**Tech Stack:** Next.js 16, React 19, TypeScript, zod 4, OpenRouter chat completions (`fetch`, no SDK), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-25-news-desk-design.md` (§5.3, §4 topic tabs, §10, §12, §13, §14 Phase 2)

## Global Constraints

- Model comes from `NEWS_DESK_MODEL` (spec D9), never `OPENROUTER_MODEL`. Key and base URL come from `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL`, which already exist on Vercel. No Terraform change in this phase.
- Chunks of 100, sent in parallel. Each request sends `[{n, title, source}]`, where `n` is the item's index in the chunk. `max_tokens` is 3,000 per chunk (spec §5.3).
- Output is strict `json_schema`. Strict mode needs an object root, so the schema is `{"tags": [{n, tag}]}`, with `tag ∈ Economy | Reforms | Legislation | Drop`.
- A chunk whose call fails, times out, or returns unusable JSON leaves its items `Untagged`; other chunks are unaffected (spec §5.3). An entry with a missing, duplicate or out-of-range `n` leaves only that item `Untagged`.
- Per-chunk timeout 40 s. Feeds take at most 8 s and the route's `maxDuration` is 60 s, so a hung tagging call cannot stop the snapshot being written.
- If `OPENROUTER_API_KEY` or `NEWS_DESK_MODEL` is unset (local dev, Playwright, CI), tagging makes no request and every new item stays `Untagged`. The refresh still saves.
- A headline is sent for tagging when its stored tag is `Untagged`. New items start `Untagged`; a failed chunk's items stay `Untagged` and are retried next refresh. This is how the spec's "only new headlines" and "retried next refresh" are both met.
- Tagging runs after the merge, so a story that arrives from two sources is tagged once.
- Tabs: All, Economy, Reforms, Legislation, each with a count. `Drop` items are never shown or counted. `Untagged` items appear only under All.
- Tests under `web/lib/news-desk/` start with `// @vitest-environment node`.
- Client components must not call `new Date()` during render (the page passes `nowIso`).
- Plain prose in comments, docs, commits and PR text (CLAUDE.md "Writing").
- Commit trailer: `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.

**Deliberate deviation from spec §5.3, "`Drop` removes off-topic items":** dropped items stay in the snapshot with `tag: "Drop"` and are hidden in the UI. If they were deleted, the next refresh would fetch them again from the feeds (they stay in the feed for days), see them as new, and pay to tag them again on every refresh for up to 14 days. Task 5 updates the spec to say this.

**Deviation from spec §13's Playwright line "tabs filter headlines":** Playwright runs without storage, so it has no snapshot to filter. Tab filtering is pinned in `NewsDesk.test.tsx` instead. The existing e2e spec is unchanged.

## Review Focus

1. **OpenRouter hangs.** Expect that chunk to be abandoned after 40 s, its items saved as `Untagged`, and the snapshot written before the route's 60 s limit. Pinned in Task 2 (an `AbortSignal` is passed; a rejected fetch leaves the chunk untagged) and Task 3 (a tagger that tags nothing still saves).
2. **No key or no model configured** (local dev, CI). Expect no request at all and a normal refresh with everything `Untagged`, not a 500 or a request to `undefined/chat/completions`. Pinned in Task 2.
3. **The dev bucket already holds a Phase 1 snapshot** with no `tag` field. Expect the page to render it (everything under All) and the next refresh to tag all of it, not "Could not read the saved headlines". Pinned in Task 1.
4. **A Google News copy already tagged, then the publisher's own copy arrives.** Expect the direct copy to replace it and keep the tag, not to be tagged and paid for again. Pinned in Task 1.
5. **The model returns partial or odd output** (skips an `n`, repeats one, returns an `n` beyond the chunk). Expect the good entries applied and only the affected items left `Untagged`. Pinned in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `web/lib/news-desk/types.ts` (modify) | Tag constants; `tag` on the headline schema; `RawHeadline` type |
| `web/lib/news-desk/parse.ts` (modify) | Return type becomes `RawHeadline[]` |
| `web/lib/news-desk/dedupe.ts` (modify) | `withId` sets `tag: "Untagged"`; merge keeps a tag across the direct-replaces-Google swap |
| `web/lib/news-desk/tagger.ts` (create) | OpenRouter tagging: chunking, request, response validation, cost total |
| `web/lib/news-desk/refresh.ts` (modify) | Tag untagged headlines after the merge; log the tagging cost |
| `web/components/news-desk/NewsDesk.tsx` (modify) | Topic tabs with counts; filter by tab; hide `Drop` |
| `web/components/news-desk/HeadlineList.tsx` (modify) | Tag label on each headline |
| `web/components/news-desk/HeadlineList.stories.tsx`, `NewsDesk.test.tsx` (modify) | Fixtures gain `tag` |
| `CHANGELOG.md`, spec §5.3 and §10, epic #253 (modify) | Unreleased entry; the Drop deviation; measured cost |

---

### Task 0: Issue and branch

No code.

- [ ] **Step 1: File the Phase 2 issue**

```bash
cd /e/Personal/looper && gh issue create \
  --title "News Desk Phase 2: topic tagging" \
  --label "enhancement" --label "priority: medium" --label "area: finance" \
  --body "$(cat <<'EOF'
## Summary

Tag each headline as Economy, Reforms, Legislation or Drop with Haiku 4.5 via OpenRouter, only for headlines not yet tagged, and add topic tabs with counts to the News Desk page.

Part of #253. Spec: `docs/superpowers/specs/2026-09-25-news-desk-design.md` §5.3. Plan: `docs/superpowers/plans/2026-09-26-news-desk-phase-2.md`.

## Done when

- A refresh tags new headlines in chunks of 100; a failed chunk leaves its items Untagged and they are retried next refresh.
- Dropped items are hidden and are not re-tagged on later refreshes.
- The page has All / Economy / Reforms / Legislation tabs with counts.
- Real refresh cost is measured and replaces the estimate in spec §10.
EOF
)"
```

Note the issue number as `<N>`. Add `- [ ] #<N>` in front of the Phase 2 line in epic #253's task list (`gh issue edit 253 --body-file …` after `gh issue view 253 --json body -q .body > body.md` and editing the line).

- [ ] **Step 2: Branch off `dev`**

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/news-desk-phase-2
```

- [ ] **Step 3: Commit the plan**

```bash
git add docs/superpowers/plans/2026-09-26-news-desk-phase-2.md
git commit -m "docs: News Desk Phase 2 plan

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 1: `tag` on headlines

**Files:**
- Modify: `web/lib/news-desk/types.ts`, `web/lib/news-desk/parse.ts:65,71`, `web/lib/news-desk/dedupe.ts:21-24,41`
- Modify (fixtures only): `web/components/news-desk/NewsDesk.test.tsx`, `web/components/news-desk/HeadlineList.stories.tsx`
- Test: `web/lib/news-desk/store.test.ts`, `web/lib/news-desk/dedupe.test.ts`

**Interfaces:**
- Produces: `TOPICS = ["Economy","Reforms","Legislation"] as const`, `Topic`; `MODEL_TAGS = [...TOPICS, "Drop"] as const`, `ModelTag`; `STORED_TAGS = [...MODEL_TAGS, "Untagged"] as const`, `StoredTag`; `Headline.tag: StoredTag` (always present on parsed/constructed headlines); `RawHeadline = Omit<Headline, "id" | "tag">`; `withId(item: RawHeadline): Headline` returns `tag: "Untagged"`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` in `web/lib/news-desk/store.test.ts`:

```ts
  it("reads a Phase 1 snapshot, whose headlines have no tag, as Untagged", async () => {
    const phase1 = {
      version: 1,
      refreshedAt: "2026-09-25T12:00:00.000Z",
      headlines: [
        {
          id: "a",
          title: "Old story",
          url: "https://ft.example/a",
          source: "FT",
          publishedAt: "2026-09-25T10:00:00.000Z",
          direct: true,
        },
      ],
      sourceErrors: [],
    };
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(phase1)));
    const snapshot = await readSnapshot();
    expect(snapshot?.headlines[0].tag).toBe("Untagged");
  });
```

Append to `web/lib/news-desk/dedupe.test.ts` (inside its top-level `describe` for `mergeHeadlines`, or a new one; `withId` and `mergeHeadlines` are already imported there):

```ts
describe("tags across a merge", () => {
  const now = new Date("2026-09-25T12:00:00.000Z");

  it("gives new items the Untagged tag", () => {
    const item = withId({
      title: "A",
      url: "https://x/a",
      source: "FT",
      publishedAt: "2026-09-25T10:00:00.000Z",
      direct: true,
    });
    expect(item.tag).toBe("Untagged");
  });

  it("keeps the stored tag when the publisher's copy replaces a Google News copy", () => {
    const google = {
      ...withId({
        title: "Cabinet approves labour codes",
        url: "https://news.google.com/rss/articles/x",
        source: "Reuters",
        publishedAt: "2026-09-25T09:00:00.000Z",
        direct: false,
      }),
      tag: "Reforms" as const,
    };
    const direct = withId({
      title: "Cabinet approves labour codes",
      url: "https://www.livemint.com/x",
      source: "Mint",
      publishedAt: "2026-09-25T09:30:00.000Z",
      direct: true,
    });
    const [merged] = mergeHeadlines([google], [direct], now);
    expect(merged.url).toBe("https://www.livemint.com/x");
    expect(merged.tag).toBe("Reforms");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/store.test.ts lib/news-desk/dedupe.test.ts`
Expected: FAIL — `tag` is `undefined`.

- [ ] **Step 3: Implement**

In `web/lib/news-desk/types.ts`, above `headlineSchema`:

```ts
// The topics shown as tabs. The model may also answer Drop for an off-topic item;
// Untagged means not yet tagged, or the tagging call failed. See spec §5.3.
export const TOPICS = ["Economy", "Reforms", "Legislation"] as const;
export type Topic = (typeof TOPICS)[number];
export const MODEL_TAGS = [...TOPICS, "Drop"] as const;
export type ModelTag = (typeof MODEL_TAGS)[number];
export const STORED_TAGS = [...MODEL_TAGS, "Untagged"] as const;
export type StoredTag = (typeof STORED_TAGS)[number];
```

Add to `headlineSchema`, after `direct`:

```ts
  // Defaulted rather than required so a Phase 1 snapshot, which has no tags,
  // still reads; the next refresh tags its items.
  tag: z.enum(STORED_TAGS).default("Untagged"),
```

After `export type Headline = …`:

```ts
/** A headline as parsed from a feed, before it has an id or a tag. */
export type RawHeadline = Omit<Headline, "id" | "tag">;
```

In `web/lib/news-desk/parse.ts`, replace both `Omit<Headline, "id">` with `RawHeadline` and import it from `./types` (drop the `Headline` import if it becomes unused).

In `web/lib/news-desk/dedupe.ts`, change `withId`:

```ts
export function withId(item: RawHeadline): Headline {
  const key = `${normalizeTitle(item.title)}|${item.publishedAt.slice(0, 10)}`;
  const id = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return { id, ...item, tag: "Untagged" };
}
```

(import `RawHeadline` alongside `Headline`), and in `mergeHeadlines` replace the replacement line:

```ts
    // The tag carries over so a story already tagged is not paid for again.
    else if (!kept[i].direct && headline.direct) kept[i] = { ...headline, tag: kept[i].tag };
```

Add `tag: "Economy"` to the first headline and `tag: "Legislation"` to the second in the `SNAPSHOT` fixture of `web/components/news-desk/NewsDesk.test.tsx`, and the same to the two headlines in `HeadlineList.stories.tsx`, so both still type-check.

- [ ] **Step 4: Run the news-desk tests and the type check**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk components/news-desk && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/lib/news-desk web/components/news-desk
git commit -m "feat(news-desk): add a tag to each headline, defaulting to Untagged

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: `tagger.ts`

**Files:**
- Create: `web/lib/news-desk/tagger.ts`
- Test: `web/lib/news-desk/tagger.test.ts`

**Interfaces:**
- Consumes: `Headline`, `MODEL_TAGS`, `ModelTag` from Task 1.
- Produces: `tagHeadlines(items: Headline[]): Promise<TagResult>` where `TagResult = { tags: Map<string, ModelTag>; calls: number; failedCalls: number; costUsd: number }`. An id missing from `tags` stays `Untagged`. Never throws.

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/tagger.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withId } from "./dedupe";
import { tagHeadlines } from "./tagger";
import type { Headline } from "./types";

function headline(i: number): Headline {
  return withId({
    title: `Story ${i}`,
    url: `https://x/${i}`,
    source: "Mint",
    publishedAt: "2026-09-25T10:00:00.000Z",
    direct: true,
  });
}

function reply(tags: unknown, cost = 0.001) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ tags }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, cost },
    }),
    { status: 200 },
  );
}

type Sent = { model: string; max_tokens: number; usage: unknown; response_format: any; messages: any[] };
function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Sent {
  const [, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string);
}
function sentItems(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const user = sentBody(fetchMock, call).messages.find((m) => m.role === "user");
  return JSON.parse(user.content) as { n: number; title: string; source: string }[];
}

describe("tagHeadlines", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.example/api/v1";
    process.env.NEWS_DESK_MODEL = "anthropic/claude-haiku-4.5";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends n, title and source with the news-desk model and a strict schema", async () => {
    const fetchMock = vi.fn(async () => reply([{ n: 0, tag: "Economy" }]));
    vi.stubGlobal("fetch", fetchMock);

    await tagHeadlines([headline(1)]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.example/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = sentBody(fetchMock);
    expect(body.model).toBe("anthropic/claude-haiku-4.5");
    expect(body.max_tokens).toBe(3000);
    expect(body.usage).toEqual({ include: true });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.tags.items.properties.tag.enum).toEqual([
      "Economy",
      "Reforms",
      "Legislation",
      "Drop",
    ]);
    expect(sentItems(fetchMock)).toEqual([{ n: 0, title: "Story 1", source: "Mint" }]);
  });

  it("maps each n back to its headline, including Drop", async () => {
    const items = [headline(1), headline(2)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply([{ n: 1, tag: "Drop" }, { n: 0, tag: "Legislation" }], 0.002)),
    );

    const result = await tagHeadlines(items);

    expect(result.tags.get(items[0].id)).toBe("Legislation");
    expect(result.tags.get(items[1].id)).toBe("Drop");
    expect(result).toMatchObject({ calls: 1, failedCalls: 0, costUsd: 0.002 });
  });

  it("splits 250 items into three calls; a failed one leaves only its items untagged", async () => {
    const items = Array.from({ length: 250 }, (_, i) => headline(i));
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const user = JSON.parse(init.body as string).messages.find((m: any) => m.role === "user");
      const sent = JSON.parse(user.content) as { n: number; title: string }[];
      if (sent[0].title === "Story 100") return new Response("upstream error", { status: 502 });
      return reply(sent.map((s) => ({ n: s.n, tag: "Economy" })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await tagHeadlines(items);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect([0, 1, 2].map((c) => sentItems(fetchMock, c).length).sort()).toEqual([100, 100, 50]);
    expect(result.tags.size).toBe(150);
    expect(result.tags.has(items[0].id)).toBe(true);
    expect(result.tags.has(items[150].id)).toBe(false);
    expect(result.tags.has(items[249].id)).toBe(true);
    expect(result).toMatchObject({ calls: 3, failedCalls: 1 });
  });

  it("leaves the chunk untagged when the content is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Sorry" } }] }))),
    );
    const result = await tagHeadlines([headline(1)]);
    expect(result.tags.size).toBe(0);
    expect(result.failedCalls).toBe(1);
  });

  it("leaves the chunk untagged when the request is aborted or the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))));
    const result = await tagHeadlines([headline(1)]);
    expect(result.tags.size).toBe(0);
    expect(result.failedCalls).toBe(1);
  });

  it("ignores a missing, repeated or out-of-range n and a tag outside the list", async () => {
    const items = [headline(1), headline(2), headline(3)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply([
          { n: 0, tag: "Reforms" },
          { n: 0, tag: "Drop" },
          { n: 7, tag: "Economy" },
          { n: 2, tag: "Sports" },
        ]),
      ),
    );

    const result = await tagHeadlines(items);

    expect(result.tags.get(items[0].id)).toBe("Reforms");
    expect(result.tags.has(items[1].id)).toBe(false);
    expect(result.tags.has(items[2].id)).toBe(false);
  });

  it("makes no request when there is nothing to tag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await tagHeadlines([])).toEqual({ tags: new Map(), calls: 0, failedCalls: 0, costUsd: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no request when the key or model is not configured", async () => {
    delete process.env.NEWS_DESK_MODEL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await tagHeadlines([headline(1)]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.tags.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/tagger.test.ts`
Expected: FAIL — cannot resolve `./tagger`.

- [ ] **Step 3: Implement `web/lib/news-desk/tagger.ts`**

```ts
import { z } from "zod";
import { MODEL_TAGS, type Headline, type ModelTag } from "./types";

// 100 items need about 1,500 output tokens; the first refresh has ~600 new items,
// which in one call would overrun the output cap and the route's 60 s. Spec §5.3.
const CHUNK_SIZE = 100;
const MAX_TOKENS = 3000;
// Feeds take at most 8 s and the route has 60 s. A hung call must not stop the
// snapshot being written.
const TIMEOUT_MS = 40_000;

const PROMPT = `You tag news headlines about India for an economics reader.
Reply with one tag per item, using its n:
- Legislation: bills, Acts, ordinances, amendments, and parliamentary committee reports.
- Reforms: policy or regulatory changes by the government, RBI, SEBI or the GST Council.
- Economy: anything else about the Indian economy: growth, prices, trade, markets, companies, public finances.
- Drop: anything not about the Indian economy, policy or law (sports, awards, ceremonies, foreign news with no Indian angle).`;

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tags"],
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "tag"],
        properties: {
          n: { type: "integer" },
          tag: { type: "string", enum: [...MODEL_TAGS] },
        },
      },
    },
  },
};

const entrySchema = z.object({ n: z.number().int(), tag: z.enum(MODEL_TAGS) });

export type TagResult = {
  tags: Map<string, ModelTag>;
  calls: number;
  failedCalls: number;
  costUsd: number;
};

/** Tags headlines by topic. Never throws: an id missing from `tags` stays Untagged
 * and is retried on the next refresh. */
export async function tagHeadlines(items: Headline[]): Promise<TagResult> {
  const result: TagResult = { tags: new Map(), calls: 0, failedCalls: 0, costUsd: 0 };
  if (items.length === 0) return result;
  // Unset in local dev, Playwright and CI. Without this check the request would
  // go to "undefined/chat/completions" and every chunk would log a failure.
  if (!process.env.OPENROUTER_API_KEY || !process.env.NEWS_DESK_MODEL) return result;

  const chunks: Headline[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) chunks.push(items.slice(i, i + CHUNK_SIZE));

  const settled = await Promise.allSettled(chunks.map(tagChunk));
  result.calls = chunks.length;
  settled.forEach((outcome, c) => {
    if (outcome.status === "rejected") {
      result.failedCalls++;
      console.error("news-desk: tagging chunk failed", outcome.reason);
      return;
    }
    result.costUsd += outcome.value.costUsd;
    outcome.value.tags.forEach((tag, n) => result.tags.set(chunks[c][n].id, tag));
  });
  return result;
}

async function tagChunk(chunk: Headline[]): Promise<{ tags: Map<number, ModelTag>; costUsd: number }> {
  const res = await fetch(`${process.env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: process.env.NEWS_DESK_MODEL,
      max_tokens: MAX_TOKENS,
      // Adds the call's cost in USD to the response, which is how spec §10 is measured.
      usage: { include: true },
      response_format: {
        type: "json_schema",
        json_schema: { name: "tags", strict: true, schema: responseJsonSchema },
      },
      messages: [
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: JSON.stringify(chunk.map((h, n) => ({ n, title: h.title, source: h.source }))),
        },
      ],
    }),
  });

  // Status before body: an edge 429 or 5xx is HTML. The key is never echoed.
  if (!res.ok) throw new Error(`OpenRouter status ${res.status}`);
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenRouter returned no content");

  let entries: unknown;
  try {
    entries = JSON.parse(content)?.tags;
  } catch {
    // A refusal or a response cut off at max_tokens still arrives as a 200.
    throw new Error("OpenRouter response was not valid JSON");
  }
  if (!Array.isArray(entries)) throw new Error("OpenRouter response has no tags array");

  // Entries are checked one at a time so one bad entry costs one item, not the chunk.
  const tags = new Map<number, ModelTag>();
  for (const entry of entries) {
    const parsed = entrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const { n, tag } = parsed.data;
    if (n < 0 || n >= chunk.length || tags.has(n)) continue;
    tags.set(n, tag);
  }
  const cost = json?.usage?.cost;
  return { tags, costUsd: typeof cost === "number" ? cost : 0 };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/tagger.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/news-desk/tagger.ts web/lib/news-desk/tagger.test.ts
git commit -m "feat(news-desk): tag headlines by topic through OpenRouter

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: Tag during refresh

**Files:**
- Modify: `web/lib/news-desk/refresh.ts`
- Test: `web/lib/news-desk/refresh.test.ts`

**Interfaces:**
- Consumes: `tagHeadlines` and `TagResult` from Task 2; `Headline.tag` from Task 1.
- Produces: `runRefresh(now?)` unchanged in signature; the returned and saved snapshot carries tags.

- [ ] **Step 1: Write the failing tests**

In `web/lib/news-desk/refresh.test.ts`, add the mock next to the others:

```ts
vi.mock("./tagger", () => ({ tagHeadlines: vi.fn() }));
```

import `tagHeadlines` from `./tagger`, and at the end of `beforeEach` add a default that tags nothing:

```ts
    vi.mocked(tagHeadlines).mockResolvedValue({ tags: new Map(), calls: 0, failedCalls: 0, costUsd: 0 });
```

Give `stored` a tag so it counts as already tagged — change its declaration to:

```ts
const stored = {
  ...withId({
    title: "Stored story",
    url: "https://ft.example/stored",
    source: "FT",
    publishedAt: "2026-09-24T10:00:00.000Z",
    direct: true,
  }),
  tag: "Economy" as const,
};
```

The existing first test's expected `headlines: [fresh, stored]` still holds (fresh stays `Untagged` because the default mock tags nothing). Add:

```ts
  it("sends only untagged headlines to the tagger and saves the tags it returns", async () => {
    // Built field by field: spreading `fresh` into withId would carry fresh's id over the new one.
    const failedBefore = withId({
      title: "Failed last time",
      url: "https://ft.example/failed",
      source: "FT",
      publishedAt: "2026-09-24T11:00:00.000Z",
      direct: true,
    });
    vi.mocked(readSnapshot).mockResolvedValue({
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [stored, failedBefore],
      sourceErrors: [],
    });
    vi.mocked(tagHeadlines).mockResolvedValue({
      tags: new Map([[fresh.id, "Reforms"]]),
      calls: 1,
      failedCalls: 0,
      costUsd: 0.001,
    });

    const result = await runRefresh(NOW);

    const sent = vi.mocked(tagHeadlines).mock.calls[0][0].map((h) => h.id).sort();
    expect(sent).toEqual([fresh.id, failedBefore.id].sort());
    const byId = new Map(result.headlines.map((h) => [h.id, h.tag]));
    expect(byId.get(fresh.id)).toBe("Reforms");
    expect(byId.get(failedBefore.id)).toBe("Untagged");
    expect(byId.get(stored.id)).toBe("Economy");
    expect(writeSnapshot).toHaveBeenCalledWith(result);
  });

  it("does not send dropped headlines again", async () => {
    const dropped = { ...stored, id: "dropped", title: "Athlete congratulated", tag: "Drop" as const };
    vi.mocked(readSnapshot).mockResolvedValue({
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [dropped],
      sourceErrors: [],
    });
    await runRefresh(NOW);
    const sent = vi.mocked(tagHeadlines).mock.calls[0][0].map((h) => h.id);
    expect(sent).toEqual([fresh.id]);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/refresh.test.ts`
Expected: FAIL — `tagHeadlines` is never called.

- [ ] **Step 3: Implement**

In `web/lib/news-desk/refresh.ts`, import `tagHeadlines` from `./tagger` and replace the body after `fetchAllFeeds`:

```ts
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

  const snapshot: Snapshot = {
    version: 1,
    refreshedAt: now.toISOString(),
    headlines: merged.map((h) => {
      const tag = tagging.tags.get(h.id);
      return tag ? { ...h, tag } : h;
    }),
    sourceErrors: errors,
  };
  await writeSnapshot(snapshot);
  return snapshot;
```

Update the route comment in `web/app/api/news-desk/refresh/route.ts` from "later phases add tagging and MoSPI calls" to say tagging now runs in the same request, with a 40 s cap per call, and MoSPI calls follow in Phase 3.

- [ ] **Step 4: Run all news-desk tests**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk app/api/news-desk`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/news-desk/refresh.ts web/lib/news-desk/refresh.test.ts web/app/api/news-desk/refresh/route.ts
git commit -m "feat(news-desk): tag untagged headlines on each refresh

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: Topic tabs and tag labels

**Files:**
- Modify: `web/components/news-desk/NewsDesk.tsx`, `web/components/news-desk/HeadlineList.tsx`, `web/components/news-desk/HeadlineList.stories.tsx`
- Test: `web/components/news-desk/NewsDesk.test.tsx`

**Interfaces:**
- Consumes: `TOPICS`, `Topic`, `Headline.tag` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `NewsDesk.test.tsx`, add a third and fourth headline to `SNAPSHOT.headlines` (after the two existing ones, which now carry `Economy` and `Legislation` from Task 1):

```ts
    {
      id: "c",
      title: "Athletes congratulated by minister",
      url: "https://news.google.com/rss/articles/c",
      source: "PIB",
      publishedAt: "2026-09-25T07:00:00.000Z",
      direct: false,
      tag: "Drop",
    },
    {
      id: "d",
      title: "RBI releases auction results",
      url: "https://www.rbi.org.in/d",
      source: "RBI",
      publishedAt: "2026-09-25T06:00:00.000Z",
      direct: true,
      tag: "Untagged",
    },
```

Update the first test's expected link list to include `"RBI releases auction results"` as the third entry (the dropped item is never shown), and in the refresh test change `toHaveLength(2)` to `toHaveLength(3)` in both places it appears. Then add:

```ts
  it("shows topic tabs with counts, never counting dropped items", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "All 3",
      "Economy 1",
      "Reforms 0",
      "Legislation 1",
    ]);
    expect(screen.getByRole("tab", { name: "All 3" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Athletes congratulated by minister")).not.toBeInTheDocument();
  });

  it("filters by tab, and shows untagged items only under All", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    fireEvent.click(screen.getByRole("tab", { name: "Legislation 1" }));
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Cabinet to decide on new BIT template",
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Reforms 0" }));
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("No headlines tagged Reforms.")).toBeInTheDocument();
  });

  it("labels each headline with its topic", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/^Economy/);
    expect(items[1]).toHaveTextContent(/^Legislation/);
    expect(items[2]).not.toHaveTextContent(/Untagged/);
  });
```

If the failed-sources `<ul>` inside `<details>` makes `getAllByRole("listitem")` include "SEBI: timed out", scope the query: `within(screen.getByRole("list", { name: "Headlines" })).getAllByRole("listitem")` and give the headline `<ul>` `aria-label="Headlines"` in Step 3 (import `within` from Testing Library).

- [ ] **Step 2: Run to see them fail**

Run: `cd /e/Personal/looper/web && npx vitest run components/news-desk`
Expected: FAIL — no tabs; dropped item is shown.

- [ ] **Step 3: Implement**

`HeadlineList.tsx`: add `aria-label="Headlines"` to the `<ul>`, and as the first child of each `<li>`:

```tsx
          {headline.tag !== "Untagged" && headline.tag !== "Drop" && (
            <p className="mb-1 text-[0.6875rem] uppercase tracking-[0.16em] text-accent">{headline.tag}</p>
          )}
```

`NewsDesk.tsx`: import `TOPICS` and `type Topic` from `../../lib/news-desk/types`, add state, and derive the lists before `return`:

```tsx
  const [tab, setTab] = useState<"All" | Topic>("All");
```

```tsx
  // Drop items stay in the snapshot so they are not re-tagged on the next
  // refresh; they are never shown. Untagged items appear only under All.
  const shown = (snapshot?.headlines ?? []).filter((h) => h.tag !== "Drop");
  const tabs: { label: "All" | Topic; count: number }[] = [
    { label: "All", count: shown.length },
    ...TOPICS.map((t) => ({ label: t, count: shown.filter((h) => h.tag === t).length })),
  ];
  const visible = tab === "All" ? shown : shown.filter((h) => h.tag === tab);
```

Replace the list branch of the final conditional:

```tsx
      ) : snapshot && snapshot.headlines.length > 0 ? (
        <>
          <div role="tablist" aria-label="Topics" className="mt-4 flex flex-wrap gap-4 border-b border-rule">
            {tabs.map(({ label, count }) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={tab === label}
                onClick={() => setTab(label)}
                className={`-mb-px border-b-2 pb-2 text-sm ${
                  tab === label ? "border-accent text-fg" : "border-transparent text-muted"
                }`}
              >
                {label}{" "}
                <span className="text-xs text-muted">{count}</span>
              </button>
            ))}
          </div>
          {visible.length > 0 ? (
            <HeadlineList headlines={visible} now={now} />
          ) : (
            <p className="mt-6 text-sm text-muted">No headlines tagged {tab}.</p>
          )}
        </>
      ) : (
```

In `HeadlineList.stories.tsx`, add a third headline with `tag: "Untagged"` so Chromatic shows both the labelled and unlabelled layouts.

- [ ] **Step 4: Run tests, lint and type check**

Run: `cd /e/Personal/looper/web && npx vitest run components/news-desk && npm run lint && npx tsc --noEmit`
Expected: PASS, no lint or type errors.

- [ ] **Step 5: Commit**

```bash
git add web/components/news-desk
git commit -m "feat(news-desk): topic tabs with counts and a tag on each headline

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: Measure cost, update docs, open the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-news-desk-design.md` (§5.3, §10), `CHANGELOG.md`, epic #253 body

- [ ] **Step 1: Full local gate**

Run: `cd /e/Personal/looper/web && npm test && npm run lint && KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build && npm run test:e2e`
Expected: all green. Paste failures in full if any.

- [ ] **Step 2: Measure real refresh cost against the dev bucket**

This writes `news-desk/snapshot.json` in the dev bucket, which is what a Refresh on the dev deployment does anyway. Take the key from `infra/main/terraform.tfvars` (`openrouter_api_key`); do not print it.

```bash
cd /e/Personal/looper/web && \
  OPENROUTER_API_KEY="$(grep openrouter_api_key ../infra/main/terraform.tfvars | cut -d'"' -f2)" \
  OPENROUTER_BASE_URL=https://openrouter.ai/api/v1 NEWS_DESK_MODEL=anthropic/claude-haiku-4.5 \
  S3_BUCKET_NAME=bgm-looper-audio-dev-223376380711 APP_AWS_REGION=us-east-1 AWS_PROFILE=personal \
  APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev
```

Log in at `http://localhost:3000/tools/news-desk` with `test123`, press Refresh, and copy the `news-desk: tagged … $X` line from the dev server output (first refresh: every headline untagged). Press Refresh again and copy the second line (later refresh). Check the tab counts and read about 20 headlines against their tags; note any systematic mislabel. Convert to INR at a current rate (look it up; per memory, not via Cost Explorer).

- [ ] **Step 3: Update the spec**

In §5.3 replace "`Drop` removes off-topic items (PIB congratulating athletes, for example)." with:

"`Drop` hides off-topic items (PIB congratulating athletes, for example). They stay in the snapshot with that tag so the next refresh does not tag them again while they are still in the feeds."

In §10 replace the first two estimate rows with the measured figures from Step 2, stating the date, token counts and rate used, e.g. `First refresh (measured 2026-09-26: N headlines, K calls) | ₹X`.

- [ ] **Step 4: CHANGELOG**

Under `## [Unreleased]` → `### Added`, edit the News Desk bullet's last sentence from "Topic tags, MoSPI indicators and the chat assistant follow in later phases" to "MoSPI indicators and the chat assistant follow in later phases", and add a bullet:

```md
- News Desk topic tags: each Refresh tags new headlines as Economy, Reforms or Legislation with Claude Haiku 4.5 through OpenRouter, and hides off-topic ones. The page has a tab per topic with counts. A first refresh measured ₹X and later ones about ₹Y (#253).
```

- [ ] **Step 5: Commit, push, PR**

```bash
cd /e/Personal/looper && git add docs CHANGELOG.md && git commit -m "docs(news-desk): measured tagging cost and the Drop behaviour

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/news-desk-phase-2
gh pr create --base dev --title "feat: News Desk Phase 2 — topic tagging" --body "…"
```

PR body: what changed (tagger, refresh, tabs), the Drop deviation and why, the measured cost, test evidence, and `Closes #<N>`. No infra change, so no `terraform plan` gate. Update the epic's Cost section with the measured figures. Then follow the `merging-a-pr` skill; do not merge without it.

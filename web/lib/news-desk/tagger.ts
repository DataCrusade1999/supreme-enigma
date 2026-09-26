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

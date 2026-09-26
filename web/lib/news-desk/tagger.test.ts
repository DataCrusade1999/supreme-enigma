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

type Message = { role: string; content: string };
type Sent = {
  model: string;
  max_tokens: number;
  usage: unknown;
  response_format: {
    type: string;
    json_schema: {
      strict: boolean;
      schema: { properties: { tags: { items: { properties: { tag: { enum: string[] } } } } } };
    };
  };
  messages: Message[];
};
function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Sent {
  const [, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string);
}
function sentItems(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const user = sentBody(fetchMock, call).messages.find((m) => m.role === "user")!;
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
      const user = (JSON.parse(init.body as string) as Sent).messages.find((m) => m.role === "user")!;
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

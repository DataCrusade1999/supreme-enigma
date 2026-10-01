// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchAllFeeds, SOURCES } from "./feeds";
import type { SourceDef } from "./types";

const FT = readFileSync(join(__dirname, "__fixtures__", "ft.xml"), "utf8");

const ok: SourceDef = { name: "FT", url: "https://ok.test/rss", kind: "direct", summary: true, region: "international" };
const broken: SourceDef = { name: "Broken", url: "https://broken.test/rss", kind: "direct", summary: false, region: "local" };
const slow: SourceDef = { name: "Slow", url: "https://slow.test/rss", kind: "direct", summary: false, region: "local" };

// A fetch that answers per URL and, like the real one, rejects when its signal aborts.
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://ok.test")) return new Response(FT, { status: 200 });
  if (url.startsWith("https://broken.test")) return new Response("Forbidden", { status: 403 });
  return new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });
}) as typeof fetch;

describe("SOURCES", () => {
  it("files the foreign outlets as international and the rest as local", () => {
    expect(SOURCES.filter((s) => s.region === "international").map((s) => s.name)).toEqual([
      "FT",
      "Google News: Reuters",
      "Google News: Bloomberg",
      "Google News: The Economist",
    ]);
    expect(SOURCES.filter((s) => s.region === "local")).toHaveLength(9);
  });

  it("has 13 sources with unique names and https URLs", () => {
    expect(SOURCES).toHaveLength(13);
    expect(new Set(SOURCES.map((s) => s.name)).size).toBe(13);
    for (const s of SOURCES) expect(s.url.startsWith("https://")).toBe(true);
  });

  it("restricts every Google News query to the last 7 days", () => {
    for (const s of SOURCES.filter((s) => s.kind === "google")) {
      expect(decodeURIComponent(new URL(s.url).searchParams.get("q")!)).toContain("when:7d");
    }
  });

  it("keeps summaries only for FT, Mint and Business Standard", () => {
    expect(SOURCES.filter((s) => s.summary).map((s) => s.name).sort()).toEqual([
      "Business Standard",
      "FT",
      "Mint",
    ]);
  });
});

describe("fetchAllFeeds", () => {
  it("returns headlines with ids from the sources that worked", async () => {
    const { headlines, errors } = await fetchAllFeeds({ sources: [ok], fetchImpl: fakeFetch });
    expect(errors).toEqual([]);
    expect(headlines).toHaveLength(1);
    expect(headlines[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(headlines[0].source).toBe("FT");
  });

  it("records a failed source and still returns the others", async () => {
    const { headlines, errors } = await fetchAllFeeds({
      sources: [ok, broken],
      fetchImpl: fakeFetch,
    });
    expect(headlines).toHaveLength(1);
    expect(errors).toEqual([{ source: "Broken", message: "status 403" }]);
  });

  it("gives up on a source that hangs, without waiting for it", async () => {
    const started = Date.now();
    const { headlines, errors } = await fetchAllFeeds({
      sources: [ok, slow],
      fetchImpl: fakeFetch,
      timeoutMs: 50,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(headlines).toHaveLength(1);
    expect(errors).toEqual([{ source: "Slow", message: "timed out" }]);
  });

  it("records a 200 response that is not RSS", async () => {
    const htmlFetch = (async () => new Response("<html></html>", { status: 200 })) as typeof fetch;
    const { errors } = await fetchAllFeeds({ sources: [ok], fetchImpl: htmlFetch });
    expect(errors).toEqual([{ source: "FT", message: "not an RSS feed" }]);
  });
});

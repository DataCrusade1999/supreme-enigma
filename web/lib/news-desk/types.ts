import { z } from "zod";
import { STORED_TAGS } from "./tags";

export * from "./tags";

export type SourceDef = {
  name: string;
  url: string;
  // "google" items come through Google News: their title carries the publisher
  // as a " - Publisher" suffix and their link is a news.google.com redirect.
  kind: "direct" | "google";
  // Only some feeds have a description worth showing. RBI's is an HTML table and
  // SEBI's repeats the title. See the design spec §5.2.
  summary: boolean;
};

export const headlineSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  source: z.string(),
  summary: z.string().optional(),
  publishedAt: z.string(),
  direct: z.boolean(),
  // Defaulted rather than required so a Phase 1 snapshot, which has no tags,
  // still reads; the next refresh tags its items.
  tag: z.enum(STORED_TAGS).default("Untagged"),
});
export type Headline = z.infer<typeof headlineSchema>;

/** A headline as parsed from a feed, before it has an id or a tag. */
export type RawHeadline = Omit<Headline, "id" | "tag">;

export const sourceErrorSchema = z.object({ source: z.string(), message: z.string() });
export type SourceError = z.infer<typeof sourceErrorSchema>;

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

export const snapshotSchema = z.object({
  version: z.literal(1),
  refreshedAt: z.string(),
  headlines: z.array(headlineSchema),
  // Defaulted so a Phase 2 snapshot still reads; the next refresh fills it.
  indicators: z.array(indicatorValueSchema).default([]),
  sourceErrors: z.array(sourceErrorSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

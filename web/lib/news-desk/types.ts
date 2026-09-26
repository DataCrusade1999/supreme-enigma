import { z } from "zod";

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

// The topics shown as tabs. The model may also answer Drop for an off-topic item;
// Untagged means not yet tagged, or the tagging call failed. See spec §5.3.
export const TOPICS = ["Economy", "Reforms", "Legislation"] as const;
export type Topic = (typeof TOPICS)[number];
export const MODEL_TAGS = [...TOPICS, "Drop"] as const;
export type ModelTag = (typeof MODEL_TAGS)[number];
export const STORED_TAGS = [...MODEL_TAGS, "Untagged"] as const;
export type StoredTag = (typeof STORED_TAGS)[number];

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

export const snapshotSchema = z.object({
  version: z.literal(1),
  refreshedAt: z.string(),
  headlines: z.array(headlineSchema),
  sourceErrors: z.array(sourceErrorSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

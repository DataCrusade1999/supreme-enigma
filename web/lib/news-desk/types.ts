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

export const headlineSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  source: z.string(),
  summary: z.string().optional(),
  publishedAt: z.string(),
  direct: z.boolean(),
});
export type Headline = z.infer<typeof headlineSchema>;

export const sourceErrorSchema = z.object({ source: z.string(), message: z.string() });
export type SourceError = z.infer<typeof sourceErrorSchema>;

export const snapshotSchema = z.object({
  version: z.literal(1),
  refreshedAt: z.string(),
  headlines: z.array(headlineSchema),
  sourceErrors: z.array(sourceErrorSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

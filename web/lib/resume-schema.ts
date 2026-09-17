import { z } from "zod";

// Trimmed-and-non-empty rather than plain string(): the model returning " "
// is valid JSON and valid `string`, but renders as a blank line on the page.
const text = z.string().trim().min(1);

export const resumeSchema = z
  .object({
    headline: z
      .object({
        name: text,
        title: text,
        summary: text,
      })
      .strict(),
    work: z
      .array(
        z
          .object({
            role: text,
            org: text,
            start: text,
            // "Present" for a current role — see the extraction prompt.
            end: text,
            bullets: z.array(text).min(1),
          })
          .strict(),
      )
      .min(1),
    skills: z
      .array(
        z
          .object({
            group: text,
            items: z.array(text).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type Resume = z.infer<typeof resumeSchema>;

// Hand-written rather than generated from the zod schema. OpenRouter's
// `strict: true` mode demands `additionalProperties: false` and an exhaustive
// `required` at every level, and the generators do not all emit that shape —
// so the contract sent to the model is written out explicitly and pinned by a
// test, rather than being whatever a converter produced this week.
export const resumeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "work", "skills"],
  properties: {
    headline: {
      type: "object",
      additionalProperties: false,
      required: ["name", "title", "summary"],
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
      },
    },
    work: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "org", "start", "end", "bullets"],
        properties: {
          role: { type: "string" },
          org: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
        },
      },
    },
    skills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["group", "items"],
        properties: {
          group: { type: "string" },
          items: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

import { describe, expect, it } from "vitest";
import { resumeSchema, resumeJsonSchema } from "./resume-schema";

const VALID = {
  headline: {
    name: "Ashutosh Pandey",
    title: "QA Engineer & DevOps Operator",
    summary: "Builds reliable systems and removes manual toil.",
  },
  work: [
    {
      role: "QA Engineer & DevOps Operator",
      org: "Creowis Technologies Pvt. Ltd.",
      start: "July 2025",
      end: "Present",
      bullets: ["Designed and maintained automated test suites using Playwright."],
    },
  ],
  skills: [{ group: "Languages", items: ["JavaScript", "Python"] }],
};

describe("resumeSchema", () => {
  it("accepts a well-formed resume", () => {
    expect(resumeSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a missing headline field", () => {
    const bad = { ...VALID, headline: { name: "A", title: "B" } };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a wrong type", () => {
    const bad = { ...VALID, work: "not an array" };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    // strict(): the model must not invent fields the page will silently drop.
    const bad = { ...VALID, education: [] };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty work array", () => {
    expect(resumeSchema.safeParse({ ...VALID, work: [] }).success).toBe(false);
  });

  it("rejects a role with no bullets", () => {
    const bad = { ...VALID, work: [{ ...VALID.work[0], bullets: [] }] };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects blank strings, which parse as valid JSON but are useless", () => {
    const bad = { ...VALID, headline: { ...VALID.headline, name: "   " } };
    expect(resumeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("resumeJsonSchema", () => {
  it("is a plain object OpenRouter can accept, not a zod instance", () => {
    expect(resumeJsonSchema.type).toBe("object");
    expect(JSON.parse(JSON.stringify(resumeJsonSchema))).toEqual(resumeJsonSchema);
  });

  it("marks every top-level field required and forbids extras", () => {
    // strict: true on OpenRouter's side requires additionalProperties: false
    // and a `required` listing every property, at every level.
    expect(resumeJsonSchema.additionalProperties).toBe(false);
    expect(resumeJsonSchema.required).toEqual(["headline", "work", "skills"]);
  });
});

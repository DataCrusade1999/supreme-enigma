// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capResult, compactMetadata, MAX_RESULT_CHARS } from "./compact";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "mospi", name), "utf8"));

describe("compactMetadata", () => {
  it("shrinks CPI base 2024 below the cap and keeps every item's code and label", () => {
    const raw = fixture("metadata-cpi-2024.json");
    const text = compactMetadata(raw);
    expect(text.length).toBeLessThan(MAX_RESULT_CHARS);
    expect(text.length).toBeLessThan(JSON.stringify(raw).length / 3);
    const items = raw.data[0].item as { item_code: number; item_name: string }[];
    expect(items).toHaveLength(358);
    for (const { item_code, item_name } of items) expect(text).toContain(`${item_code}=${item_name}`);
    expect(text).toContain("division: 0=CPI (General); 1=Food and beverages");
    expect(text).not.toContain("viz");
  });

  it("lists the get_data parameters with their allowed values and notes", () => {
    const text = compactMetadata(fixture("metadata-cpi-2024.json"));
    expect(text).toContain("get_data filters:");
    expect(text).toContain("- base_year (required) one of 2012/2010/2024");
  });

  it("finds lists nested under filter_values, as PLFS returns them", () => {
    const text = compactMetadata(fixture("metadata-plfs.json"));
    expect(text).toContain("gender: 1=male; 2=female; 3=person");
    expect(text).toContain("sector: 1=rural; 2=urban; 3=rural + urban");
  });

  it("keeps a list without codes as plain values", () => {
    const text = compactMetadata(fixture("metadata-iip.json"));
    expect(text).toContain("type: General; Sectoral; Use-based category");
  });
});

describe("capResult", () => {
  it("leaves a short result alone", () => {
    expect(capResult("abc")).toBe("abc");
  });

  it("cuts a long result at the cap and says so", () => {
    const text = capResult("x".repeat(MAX_RESULT_CHARS + 10));
    expect(text.startsWith("x".repeat(MAX_RESULT_CHARS))).toBe(true);
    expect(text).toContain("[Truncated at 24000 characters. Ask for a narrower level or fewer rows.]");
  });
});

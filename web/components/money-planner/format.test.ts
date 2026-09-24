import { describe, expect, it } from "vitest";
import { formatAway, formatInr, formatLongDate, formatShortDate } from "./format";

const groupsIndian = new Intl.NumberFormat("en-IN").format(125_000).includes("1,25,000");

describe("formatInr", () => {
  it("prefixes the rupee sign and drops the paise", () => {
    expect(formatInr(125_000)).toContain("₹");
    expect(formatInr(125_000)).not.toContain(".");
  });

  it.runIf(groupsIndian)("groups in lakhs", () => {
    // Skipped on a small-ICU Node, where en-IN falls back to western grouping.
    expect(formatInr(125_000)).toContain("1,25,000");
  });

  it("formats a negative amount", () => {
    expect(formatInr(-4_200)).toContain("4,200");
  });

  it("rounds a fractional average to whole rupees", () => {
    expect(formatInr(58_400.5)).not.toContain(".");
  });
});

describe("formatShortDate", () => {
  it("uses a three-letter month and keeps the year", () => {
    expect(formatShortDate("2027-03-04")).toBe("4 Mar 2027");
    expect(formatShortDate("2026-09-30")).toBe("30 Sep 2026");
  });
});

describe("formatLongDate", () => {
  it("reads the date as written, with no timezone in the way", () => {
    expect(formatLongDate("2027-03-04")).toBe("4 March 2027");
    expect(formatLongDate("2026-12-31")).toBe("31 December 2026");
    expect(formatLongDate("2026-01-01")).toBe("1 January 2026");
  });
});

describe("formatAway", () => {
  it("counts whole months", () => {
    expect(formatAway("2026-09-19", "2028-02-19")).toBe("17 months away");
  });

  it("does not pluralise a single month", () => {
    expect(formatAway("2026-09-19", "2026-10-19")).toBe("1 month away");
  });

  it("counts days when it is under a month", () => {
    expect(formatAway("2026-09-19", "2026-10-01")).toBe("12 days away");
    expect(formatAway("2026-09-19", "2026-09-20")).toBe("1 day away");
  });

  it("says today for today", () => {
    expect(formatAway("2026-09-19", "2026-09-19")).toBe("today");
  });
});

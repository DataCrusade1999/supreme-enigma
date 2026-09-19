import { describe, expect, it } from "vitest";
import {
  addYears,
  compareIso,
  dueDatesBetween,
  lastDayOfMonth,
  makeIso,
  nextOccurrenceOnOrAfter,
  parseIso,
  payDatesBetween,
  todayIso,
} from "./money-planner-dates";

describe("lastDayOfMonth", () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2000, 2, 29],
    [1900, 2, 28],
    [2026, 4, 30],
  ])("%i-%i has %i days", (year, month, days) => {
    expect(lastDayOfMonth(year, month)).toBe(days);
  });
});

describe("makeIso", () => {
  it("pads to YYYY-MM-DD", () => {
    expect(makeIso(2026, 3, 4)).toBe("2026-03-04");
  });

  it("clamps a day past the end of the month", () => {
    expect(makeIso(2026, 2, 31)).toBe("2026-02-28");
    expect(makeIso(2026, 4, 31)).toBe("2026-04-30");
  });
});

describe("parseIso", () => {
  it("reads the parts as numbers", () => {
    expect(parseIso("2026-03-04")).toEqual({ year: 2026, month: 3, day: 4 });
  });
});

describe("compareIso", () => {
  it("orders lexically, which is chronological for this format", () => {
    expect(compareIso("2026-03-04", "2026-03-05")).toBeLessThan(0);
    expect(compareIso("2027-01-01", "2026-12-31")).toBeGreaterThan(0);
    expect(compareIso("2026-03-04", "2026-03-04")).toBe(0);
  });
});

describe("nextOccurrenceOnOrAfter", () => {
  it("returns the anchor itself when it has not passed", () => {
    expect(nextOccurrenceOnOrAfter("2026-10-04", 3, "2026-09-19")).toBe("2026-10-04");
    expect(nextOccurrenceOnOrAfter("2026-09-19", 3, "2026-09-19")).toBe("2026-09-19");
  });

  it("rolls a stale anchor forward by whole cycles", () => {
    // A quarterly expense last set up for April, opened again in September.
    expect(nextOccurrenceOnOrAfter("2026-04-10", 3, "2026-09-19")).toBe("2026-10-10");
  });

  it("anchors every occurrence to the original day, without drift", () => {
    // Jan 31 quarterly: April has 30 days, but July must return to the 31st.
    expect(nextOccurrenceOnOrAfter("2026-01-31", 3, "2026-04-01")).toBe("2026-04-30");
    expect(nextOccurrenceOnOrAfter("2026-01-31", 3, "2026-05-01")).toBe("2026-07-31");
  });
});

describe("dueDatesBetween", () => {
  it("lists a quarterly expense across a year boundary", () => {
    expect(dueDatesBetween("2026-11-04", 3, "2026-09-19", "2027-06-30")).toEqual([
      "2026-11-04",
      "2027-02-04",
      "2027-05-04",
    ]);
  });

  it("includes an occurrence falling on the first day of the window", () => {
    expect(dueDatesBetween("2026-09-19", 1, "2026-09-19", "2026-11-30")).toEqual([
      "2026-09-19",
      "2026-10-19",
      "2026-11-19",
    ]);
  });

  it("skips the occurrences that have already gone by", () => {
    expect(dueDatesBetween("2026-01-04", 3, "2026-09-19", "2027-01-31")).toEqual([
      "2026-10-04",
      "2027-01-04",
    ]);
  });

  it("returns nothing when the first occurrence is past the window", () => {
    expect(dueDatesBetween("2027-01-04", 12, "2026-09-19", "2026-12-31")).toEqual([]);
  });
});

describe("payDatesBetween", () => {
  it("lists a pay day every month", () => {
    expect(payDatesBetween(4, "2026-09-19", "2027-01-10")).toEqual([
      "2026-10-04",
      "2026-11-04",
      "2026-12-04",
      "2027-01-04",
    ]);
  });

  it("clamps a 31st pay day to the end of short months and comes back", () => {
    expect(payDatesBetween(31, "2026-01-01", "2026-05-01")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("clamps a 29th pay day in a non-leap February", () => {
    expect(payDatesBetween(29, "2026-02-01", "2026-03-01")).toEqual(["2026-02-28"]);
  });

  it("includes a pay day falling on the window's first day", () => {
    expect(payDatesBetween(19, "2026-09-19", "2026-10-01")).toEqual(["2026-09-19"]);
  });
});

describe("addYears", () => {
  it("moves the horizon out by whole years", () => {
    expect(addYears("2026-09-19", 10)).toBe("2036-09-19");
  });

  it("clamps 29 February", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
  });
});

describe("todayIso", () => {
  it("reads the local calendar date, not the UTC one", () => {
    // 23:30 local on the 19th is already the 20th in UTC. The user's calendar
    // is the one that matters.
    const late = new Date(2026, 8, 19, 23, 30);
    expect(todayIso(late)).toBe("2026-09-19");
  });
});

import { describe, expect, it } from "vitest";
import { formatDay, formatUntil, formatUses } from "./access-format";

describe("access-format", () => {
  it("formats an expiry in IST", () => {
    expect(formatUntil(1_795_180_380)).toBe("20 Nov 2026, 6:43 pm IST");
  });

  it("pluralises uses", () => {
    expect(formatUses(1)).toBe("1 use");
    expect(formatUses(20)).toBe("20 uses");
    expect(formatUses(0)).toBe("0 uses");
  });

  it("formats a day in IST", () => {
    // 31 Oct 2026, 23:30 UTC is already 1 Nov in IST; 06:30 UTC is noon on the 31st.
    expect(formatDay(Date.UTC(2026, 9, 31, 6, 30) / 1000)).toBe("31 Oct");
    expect(formatDay(Date.UTC(2026, 9, 31, 23, 30) / 1000)).toBe("1 Nov");
  });
});

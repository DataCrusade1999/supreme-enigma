// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatAge } from "./format";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("formatAge", () => {
  it.each([
    [ago(30_000), "just now"],
    [ago(5 * 60_000), "5m ago"],
    [ago(3 * 3_600_000), "3h ago"],
    [ago(2 * 86_400_000), "2d ago"],
    // A feed clock slightly ahead of ours is not "in the future".
    [new Date(NOW.getTime() + 60_000).toISOString(), "just now"],
  ])("%s → %s", (iso, expected) => {
    expect(formatAge(iso, NOW)).toBe(expected);
  });
});

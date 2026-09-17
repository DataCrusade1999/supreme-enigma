/*
 * A stylised envelope, not a real analysis. The first and last eight bars are
 * the same eight values, which is what a seamless loop actually looks like:
 * the tail is already the head. Bars over PEAK read as peaks.
 *
 * Shared, not duplicated: the home page draws it as a line and LoopRing wraps
 * the same array into a circle. See the design spec §5.
 */
export const HEAD = [18, 34, 27, 52, 41, 63, 38, 46];
export const BODY = [
  30, 47, 71, 55, 82, 61, 44, 58, 73, 49, 36, 66, 88, 70, 52, 39, 57, 80, 62,
  45, 33, 51, 68, 84, 59, 42, 30, 48, 65, 77, 54, 40, 62, 86, 69, 47, 35, 53,
  44, 29,
];
export const WAVE = [...HEAD, ...BODY, ...HEAD];
export const PEAK = 78;

/**
 * Head and tail bars take the accent, peaks take the peak colour, the rest the
 * ink — shared so the linear figure on the home page and LoopRing's circle
 * cannot drift apart. See the design spec §5.
 */
export function barClass(height: number, index: number) {
  if (height >= PEAK) return "bg-peak";
  if (index < HEAD.length || index >= HEAD.length + BODY.length)
    return "bg-accent";
  return "bg-fg/25";
}

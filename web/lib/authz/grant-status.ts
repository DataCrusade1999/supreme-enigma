import { isMetered } from "../route-gate";
import type { Grant } from "./grants";

/** Epoch seconds. A grant is unexpired while `now < expiresAt`. */
export function isUnexpired(g: Grant, now: number): boolean {
  return now < g.expiresAt;
}

/** Unexpired and, for a metered key, with a use left. */
export function isLive(g: Grant, now: number): boolean {
  if (!isUnexpired(g, now)) return false;
  return !isMetered(g.action) || (g.used ?? 0) < (g.limit ?? 0);
}

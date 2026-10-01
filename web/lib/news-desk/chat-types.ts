// Shared by the ask route and the chat panel. No zod and no Node imports, so a
// client component can import it.
import type { Point } from "./series";

export type ChartQuery = {
  title: string;
  unit: string;
  dataset: string;
  filters: Record<string, string>;
  valueField: string;
  match?: Record<string, string>;
};

export type AnswerEvent = {
  type: "answer";
  text: string;
  chart: { title: string; unit: string; points: Point[] } | null;
  // True when the server re-ran the chart query and got a valid series (spec §7.3).
  pinnable: boolean;
  query: ChartQuery | null;
};

export type AskEvent = { type: "step"; label: string } | AnswerEvent | { type: "error"; message: string };

// Pinned indicators have ids of this form; defaults never do (#269).
export const PIN_PREFIX = "pin-";

export function isPinId(id: string): boolean {
  return id.startsWith(PIN_PREFIX);
}

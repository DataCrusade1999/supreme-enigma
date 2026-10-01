import { createHash } from "node:crypto";
import { z } from "zod";
import { isPinId, PIN_PREFIX } from "./chat-types";
import { readPins, readSnapshot, SnapshotCorruptError, writePins, writeSnapshot } from "./store";
import type { IndicatorDef, IndicatorValue } from "./types";

const text = z.string().trim().min(1).max(100);
const fields = z.record(text, text).refine((r) => Object.keys(r).length <= 30, "too many fields");

export const pinInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  dataset: text,
  filters: fields,
  valueField: text,
  unit: z.string().max(20),
  match: fields.optional(),
});
export type PinInput = z.infer<typeof pinInputSchema>;

export class PinError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sorted = (r: Record<string, string> | undefined) =>
  r ? Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))) : null;

/** Derived from the query, so the same chart cannot be pinned twice, and
 * prefixed so a pin cannot take a default's id (#269). */
export function pinId(q: Pick<PinInput, "dataset" | "filters" | "valueField" | "match">): string {
  const key = JSON.stringify([q.dataset, sorted(q.filters), q.valueField, sorted(q.match)]);
  return `${PIN_PREFIX}${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

/** Keeps the saved table in step without a Refresh. Skipped when nothing is
 * saved yet or the snapshot is corrupt: the next Refresh writes a whole one. */
async function updateSnapshot(change: (rows: IndicatorValue[]) => IndicatorValue[]): Promise<void> {
  let snapshot;
  try {
    snapshot = await readSnapshot();
  } catch (err) {
    if (err instanceof SnapshotCorruptError) return;
    throw err;
  }
  if (!snapshot) return;
  await writeSnapshot({ ...snapshot, indicators: change(snapshot.indicators) });
}

export async function pinIndicator(input: PinInput): Promise<IndicatorValue> {
  // readPins throws when the file exists but cannot be read. Writing anyway
  // would replace the owner's pins with this one (spec §6.3).
  const pins = await readPins();
  const id = pinId(input);
  if (pins.some((p) => p.id === id)) throw new PinError("already pinned", 409);
  const def: IndicatorDef = { id, ...input };
  await writePins([...pins, def]);
  // Filled on the next Refresh (spec §7.3).
  const row: IndicatorValue = { id, label: def.label, unit: def.unit, period: null, latest: null, prevPeriod: null, prev: null, lastGoodAt: null };
  await updateSnapshot((rows) => [...rows.filter((r) => r.id !== id), row]);
  return row;
}

export async function unpinIndicator(id: string): Promise<void> {
  if (!isPinId(id)) throw new PinError("default indicators cannot be removed", 400);
  const pins = await readPins();
  if (!pins.some((p) => p.id === id)) throw new PinError("not pinned", 404);
  await writePins(pins.filter((p) => p.id !== id));
  await updateSnapshot((rows) => rows.filter((r) => r.id !== id));
}

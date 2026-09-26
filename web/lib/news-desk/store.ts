import { getObjectBytes, putObjectJson } from "@/lib/aws";
import { z } from "zod";
import { DEFAULT_INDICATORS } from "./defaults";
import { indicatorDefSchema, snapshotSchema, type IndicatorDef, type Snapshot } from "./types";

export const SNAPSHOT_KEY = "news-desk/snapshot.json";

/** The stored file exists but cannot be used. A refresh overwrites it; see refresh.ts. */
export class SnapshotCorruptError extends Error {}

// The per-branch bucket, unlike the resume, which lives in main's bucket on every
// branch. Unset in local dev, Playwright and CI builds.
export function isStorageConfigured(): boolean {
  return Boolean(process.env.S3_BUCKET_NAME);
}

function bucket(): string {
  const name = process.env.S3_BUCKET_NAME;
  if (!name) throw new Error("S3_BUCKET_NAME is not set");
  return name;
}

export async function readSnapshot(): Promise<Snapshot | null> {
  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(bucket(), SNAPSHOT_KEY);
  } catch (err) {
    // Only a missing object means "nothing saved yet". Anything else — an IAM
    // change, an expired credential — has to surface. This relies on the role
    // holding s3:ListBucket; without it a missing key is AccessDenied.
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new SnapshotCorruptError("stored snapshot is not valid JSON");
  }
  const parsed = snapshotSchema.safeParse(json);
  if (!parsed.success) throw new SnapshotCorruptError("stored snapshot does not match the schema");
  return parsed.data;
}

export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await putObjectJson(bucket(), SNAPSHOT_KEY, snapshot);
}

export const INDICATORS_KEY = "news-desk/indicators.json";

/** The pinned indicator definitions. `indicators.json` holds only pins: stored
 * defaults would never pick up a change to DEFAULT_INDICATORS (spec §6.2). */
export async function readPins(): Promise<IndicatorDef[]> {
  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(bucket(), INDICATORS_KEY);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return [];
    throw err;
  }
  return z.array(indicatorDefSchema).parse(JSON.parse(bytes.toString("utf8")));
}

export async function writePins(pins: IndicatorDef[]): Promise<void> {
  await putObjectJson(bucket(), INDICATORS_KEY, pins);
}

/** The defaults, then the pins. */
export async function readIndicatorDefs(): Promise<IndicatorDef[]> {
  const defaultIds = new Set(DEFAULT_INDICATORS.map((d) => d.id));
  const pins = await readPins();
  return [...DEFAULT_INDICATORS, ...pins.filter((p) => !defaultIds.has(p.id))];
}

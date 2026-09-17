/** What the tool page gets back from /api/looper/process: the download link,
 * when it stops working, and what the DSP pipeline decided. */
export type LoopResult = {
  downloadUrl: string;
  /** ISO timestamp — the presigned link's 300s TTL, resolved server-side so
   * the countdown doesn't depend on the visitor's clock being right. */
  expiresAt: string;
  /** Bar heights, 0-1, for the result waveform. */
  peaks: number[];
  durationSec: number;
  sampleRate: number;
  channels: number;
  tempoBpm: number | null;
  /** Where the loop was cut from in the trimmed source, or null when no beat
   * grid was found and the whole track became the loop. */
  loopStartSec: number | null;
  loopEndSec: number | null;
  crossfadeMs: number;
  targetLufs: number;
  /** False when the pipeline answered without describing the loop — a Lambda
   * still on the pre-metadata image during a deploy. The loop itself is fine;
   * the page hides the decisions panel rather than printing zeros for it. */
  hasMetadata: boolean;
};

type LambdaResult = Partial<{
  output_key: string;
  peaks: number[];
  duration_sec: number;
  sample_rate: number;
  channels: number;
  tempo_bpm: number | null;
  loop_start_sec: number | null;
  loop_end_sec: number | null;
  crossfade_ms: number;
  target_lufs: number;
}>;

/** The pipeline speaks snake_case Python; the page speaks camelCase TS. */
export function toLoopResult(
  raw: LambdaResult,
  downloadUrl: string,
  expiresAt: string,
): LoopResult {
  return {
    downloadUrl,
    expiresAt,
    peaks: raw.peaks ?? [],
    durationSec: raw.duration_sec ?? 0,
    sampleRate: raw.sample_rate ?? 0,
    channels: raw.channels ?? 0,
    tempoBpm: raw.tempo_bpm ?? null,
    loopStartSec: raw.loop_start_sec ?? null,
    loopEndSec: raw.loop_end_sec ?? null,
    crossfadeMs: raw.crossfade_ms ?? 0,
    targetLufs: raw.target_lufs ?? 0,
    hasMetadata: raw.duration_sec !== undefined,
  };
}

/** Read a Lambda invoke payload, or null if it isn't the JSON we expect —
 * the caller answers with the same error shape it uses for FunctionError
 * rather than letting a parse throw out of the route as an opaque 500. */
export function parseLambdaPayload(payload: Uint8Array | undefined): LambdaResult | null {
  try {
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload).toString());
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

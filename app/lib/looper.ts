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
  tempoBpm: number;
  /** Where the loop was cut from in the trimmed source, or null when no beat
   * grid was found and the whole track became the loop. */
  loopStartSec: number | null;
  loopEndSec: number | null;
  crossfadeMs: number;
  targetLufs: number;
};

type LambdaResult = Partial<{
  peaks: number[];
  duration_sec: number;
  sample_rate: number;
  channels: number;
  tempo_bpm: number;
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
    tempoBpm: raw.tempo_bpm ?? 0,
    loopStartSec: raw.loop_start_sec ?? null,
    loopEndSec: raw.loop_end_sec ?? null,
    crossfadeMs: raw.crossfade_ms ?? 0,
    targetLufs: raw.target_lufs ?? 0,
  };
}

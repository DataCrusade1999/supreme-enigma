import { describe, expect, it } from "vitest";
import { toLoopResult } from "./looper";

const lambdaPayload = {
  output_key: "outputs/abc.wav",
  peaks: [0.25, 1],
  duration_sec: 158.2,
  sample_rate: 48000,
  channels: 2,
  tempo_bpm: 96,
  loop_start_sec: 4.5,
  loop_end_sec: 162.7,
  crossfade_ms: 50,
  target_lufs: -14,
};

describe("toLoopResult", () => {
  it("renames the pipeline's fields for the browser", () => {
    const result = toLoopResult(lambdaPayload, "https://s3/download", "2026-09-11T10:05:00.000Z");

    expect(result).toEqual({
      downloadUrl: "https://s3/download",
      expiresAt: "2026-09-11T10:05:00.000Z",
      peaks: [0.25, 1],
      durationSec: 158.2,
      sampleRate: 48000,
      channels: 2,
      tempoBpm: 96,
      loopStartSec: 4.5,
      loopEndSec: 162.7,
      crossfadeMs: 50,
      targetLufs: -14,
    });
  });

  it("carries a missing loop point through as null rather than zero", () => {
    const result = toLoopResult(
      { ...lambdaPayload, loop_start_sec: null, loop_end_sec: null },
      "https://s3/download",
      "2026-09-11T10:05:00.000Z",
    );

    expect(result.loopStartSec).toBeNull();
    expect(result.loopEndSec).toBeNull();
  });

  it("falls back to an empty waveform when the pipeline sent no peaks", () => {
    const { peaks, ...withoutPeaks } = lambdaPayload;
    void peaks;

    const result = toLoopResult(withoutPeaks, "https://s3/download", "2026-09-11T10:05:00.000Z");

    expect(result.peaks).toEqual([]);
  });
});

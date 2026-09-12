import { describe, expect, it } from "vitest";
import { parseLambdaPayload, toLoopResult } from "./looper";

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
      hasMetadata: true,
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

  it("reports metadata as unavailable when the pipeline predates it", () => {
    // A Lambda still on the pre-metadata image (the window between the Vercel
    // deploy and the function update) answers with only the output key.
    const result = toLoopResult(
      { output_key: "outputs/abc.wav" },
      "https://s3/download",
      "2026-09-11T10:05:00.000Z",
    );

    expect(result.hasMetadata).toBe(false);
    expect(result.downloadUrl).toBe("https://s3/download");
  });

  it("reports metadata as available when the pipeline described the loop", () => {
    expect(toLoopResult(lambdaPayload, "https://s3/d", "2026-09-11T10:05:00.000Z").hasMetadata).toBe(
      true,
    );
  });

  it("falls back to an empty waveform when the pipeline sent no peaks", () => {
    const { peaks, ...withoutPeaks } = lambdaPayload;
    void peaks;

    const result = toLoopResult(withoutPeaks, "https://s3/download", "2026-09-11T10:05:00.000Z");

    expect(result.peaks).toEqual([]);
  });
});

describe("parseLambdaPayload", () => {
  it("reads the invoke payload", () => {
    const payload = Buffer.from(JSON.stringify({ output_key: "outputs/abc.wav", tempo_bpm: 96 }));

    expect(parseLambdaPayload(payload)).toEqual({
      output_key: "outputs/abc.wav",
      tempo_bpm: 96,
    });
  });

  it.each([
    ["a missing payload", undefined],
    ["an empty payload", Buffer.from("")],
    ["a non-JSON payload", Buffer.from("Not JSON at all")],
    ["NaN in the payload", Buffer.from('{"peaks":[NaN,1.0]}')],
  ])("returns null for %s rather than throwing", (_label, payload) => {
    expect(parseLambdaPayload(payload as Uint8Array | undefined)).toBeNull();
  });
});

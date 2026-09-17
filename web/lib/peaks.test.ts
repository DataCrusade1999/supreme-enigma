import { describe, expect, it } from "vitest";
import { peaksFromChannel, PEAK_COUNT } from "./peaks";

describe("peaksFromChannel", () => {
  it("reduces samples to the fixed bar count the waveform draws", () => {
    const samples = new Float32Array(PEAK_COUNT * 10).fill(0.5);

    const peaks = peaksFromChannel(samples);

    expect(peaks).toHaveLength(PEAK_COUNT);
  });

  it("takes the loudest sample in each bucket, scaled against the loudest bar", () => {
    // Two buckets' worth: a quiet first half, a loud second half.
    const samples = new Float32Array(4);
    samples.set([0.1, -0.2, 0.4, -0.8]);

    const peaks = peaksFromChannel(samples, 2);

    expect(peaks).toEqual([0.25, 1]);
  });

  it("returns silent bars rather than dividing by zero on a silent track", () => {
    const peaks = peaksFromChannel(new Float32Array(64), 4);

    expect(peaks).toEqual([0, 0, 0, 0]);
  });

  it("pads a track that does not divide evenly into buckets", () => {
    const samples = new Float32Array([1, 1, 1, 1, 1]);

    const peaks = peaksFromChannel(samples, 4);

    expect(peaks).toHaveLength(4);
    expect(peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
  });

  it("returns an empty bar for an empty track", () => {
    expect(peaksFromChannel(new Float32Array(0), 3)).toEqual([0, 0, 0]);
  });
});

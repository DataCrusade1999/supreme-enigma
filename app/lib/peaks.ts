/** Bars in the waveform. Matches PEAK_COUNT in lambda/src/looper/pipeline.py,
 * so the track you dropped and the loop you get back are drawn at the same
 * resolution. */
export const PEAK_COUNT = 240;

/**
 * Bar heights for a waveform: the loudest sample in each bucket, scaled
 * against the loudest bucket so the drawn waveform fills its frame.
 *
 * The Lambda computes the same thing for the processed result; this is the
 * browser's copy, run on the file before it is uploaded.
 */
export function peaksFromChannel(
  samples: Float32Array,
  count: number = PEAK_COUNT,
): number[] {
  const bucketSize = Math.ceil(samples.length / count) || 1;
  const buckets: number[] = [];

  for (let i = 0; i < count; i++) {
    let peak = 0;
    const start = i * bucketSize;
    const end = Math.min(start + bucketSize, samples.length);
    for (let k = start; k < end; k++) {
      const v = Math.abs(samples[k]);
      if (v > peak) peak = v;
    }
    buckets.push(peak);
  }

  const loudest = Math.max(...buckets);
  if (loudest === 0) return buckets;
  return buckets.map((p) => p / loudest);
}

import { peaksFromChannel } from "./peaks";

/**
 * Decode a picked file in the browser and reduce it to waveform bars, so the
 * page can draw the actual track before anything is uploaded.
 *
 * Returns null when the browser has no Web Audio or can't decode the format
 * (FLAC and some M4A variants, depending on the browser) — the caller carries
 * on with the upload either way.
 *
 * decodeAudioData is main-thread only; it hands the work to the browser's own
 * decoder thread, and the bucketing loop that follows is a few milliseconds.
 */
export async function decodePeaks(file: File): Promise<number[] | null> {
  if (typeof OfflineAudioContext === "undefined") return null;

  try {
    const bytes = await file.arrayBuffer();
    const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
    return peaksFromChannel(audio.getChannelData(0));
  } catch {
    return null;
  }
}

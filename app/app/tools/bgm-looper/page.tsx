"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CommandBar } from "../../../components/site/CommandBar";
import { decodePeaks } from "../../../lib/decode-audio";
import type { LoopResult } from "../../../lib/looper";

type Status = "idle" | "decoding" | "uploading" | "processing" | "done" | "error";

// The four steps the page can honestly report. Server-side work is one opaque
// Lambda invoke, so "processing" is a single step rather than a fake sub-progress.
const STEPS = [
  {
    id: "decoding",
    title: "Read in your browser",
    detail: "Decoded to peaks locally — the bars above are this file, not a stand-in.",
  },
  {
    id: "uploading",
    title: "Upload",
    detail: "Straight to S3 with a presigned URL — it never passes through the page's server.",
  },
  {
    id: "processing",
    title: "Loop, crossfade, normalize",
    detail: "Beat-aligned loop point, 50 ms equal-power fade across the seam, −14 LUFS out.",
  },
] as const;

const STEP_ORDER: Status[] = ["decoding", "uploading", "processing", "done"];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Waveform({ peaks, progress }: { peaks: number[]; progress: number | null }) {
  return (
    <div className="relative mt-4 h-33 overflow-hidden border-y border-line py-3.5">
      {progress !== null && (
        <div
          className="absolute top-0 left-0 h-full bg-accent/10"
          style={{ width: `${progress * 100}%` }}
        />
      )}
      <div className="relative flex h-full items-end gap-0.5">
        {peaks.map((peak, i) => (
          <div
            key={i}
            data-bar
            className="flex-1 bg-fg/25"
            // A silent bar still gets the 2px rest line, so the waveform reads
            // as a track rather than as an empty box.
            style={{ height: `max(2px, ${Math.round(peak * 100)}%)` }}
          />
        ))}
      </div>
      {progress !== null && (
        <div
          className="absolute top-0 h-full w-0.5 bg-accent"
          style={{ left: `${progress * 100}%` }}
        />
      )}
    </div>
  );
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [result, setResult] = useState<LoopResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleFile = useCallback(async (picked: File) => {
    setFile(picked);
    setError(null);
    setResult(null);
    setExpiresIn(null);
    setPlaying(false);
    setProgress(0);

    // Cleared before the await, not after: decoding a large file takes long
    // enough that the previous track's bars would otherwise sit under the new
    // file's name, presented as if they were it.
    setPeaks([]);

    setStatus("decoding");
    const localPeaks = await decodePeaks(picked);
    setPeaks(localPeaks ?? []);

    try {
      setStatus("uploading");
      const urlRes = await fetch("/api/looper/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: picked.name,
          contentType: picked.type,
          size: picked.size,
        }),
      });
      const { key, uploadUrl } = await urlRes.json();

      await fetch(uploadUrl, {
        method: "PUT",
        body: picked,
        headers: { "Content-Type": picked.type },
      });

      setStatus("processing");
      const processRes = await fetch("/api/looper/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!processRes.ok) throw new Error("Processing failed");
      const loop: LoopResult = await processRes.json();

      setResult(loop);
      if (loop.peaks.length > 0) setPeaks(loop.peaks);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, []);

  // The playhead follows real playback rather than a fixed animation, so the
  // teal rule is always where the track actually is.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playing) return;

    let frame = 0;
    const tick = () => {
      if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    if (!result) return;
    const expiry = new Date(result.expiresAt).getTime();
    const update = () => setExpiresIn(Math.max(0, Math.round((expiry - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [result]);

  const busy = status === "decoding" || status === "uploading" || status === "processing";
  const stepIndex = STEP_ORDER.indexOf(status);
  // The pipeline's figure when it sent one, the element's own otherwise.
  const playerDuration = result?.durationSec || duration;

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // play() rejects on an expired presigned link, among other things — the
      // transport must not flip to Pause over silence.
      audio.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }

  return (
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
          Tools / BGM Looper
        </span>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-5 py-14 sm:px-10">
        <div className="col-span-12 lg:col-span-7">
          <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
            {status === "done" ? (
              <span className="text-accent">Looped</span>
            ) : status === "error" ? (
              <span className="text-peak">Didn&apos;t finish</span>
            ) : (
              "Audio tool"
            )}
          </p>
          <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">
            BGM Looper
          </h1>
          <div className="mt-5 border-b-2 border-rule-heavy" />

          {status === "idle" && (
            <p className="mt-[18px] max-w-[52ch] text-base leading-relaxed text-muted">
              Upload a background-music track and get back a seamlessly looping,
              loudness-normalized version — beat-aligned loop point, equal-power crossfade,
              computed by a Python DSP pipeline on AWS&nbsp;Lambda.
            </p>
          )}

          {file && status !== "idle" && (
            <div className="mt-7 flex items-baseline justify-between gap-6">
              <p className="text-[1.0625rem] font-semibold tracking-tight">{file.name}</p>
              {result?.hasMetadata && (
                <p className="text-[0.8125rem] text-muted">
                  {formatTime(result.durationSec)} · {(result.sampleRate / 1000).toFixed(1)} kHz
                  {result.channels === 2 ? " stereo" : " mono"}
                </p>
              )}
            </div>
          )}

          {peaks.length > 0 && status !== "idle" && (
            <div onClick={status === "done" ? seek : undefined}>
              <Waveform peaks={peaks} progress={status === "done" ? progress : null} />
            </div>
          )}

          {busy && (
            <>
              <div className="mt-5 flex items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="block h-[18px] w-1 shrink-0 bg-accent" />
                  <p className="text-[1.0625rem] font-medium tracking-tight">
                    {status === "decoding"
                      ? "Reading the waveform…"
                      : status === "uploading"
                        ? "Uploading…"
                        : "Looping the track…"}
                  </p>
                </div>
                <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
                  Step {stepIndex + 1} of {STEPS.length}
                </p>
              </div>
              <div className="relative mt-3.5 h-0.5 bg-line">
                <div
                  className="absolute top-0 left-0 h-full bg-fg transition-[width] duration-300 ease-out motion-reduce:transition-none"
                  style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
                />
              </div>
              <p className="mt-4 max-w-[52ch] text-[0.8125rem] leading-relaxed text-muted">
                {status === "decoding"
                  ? "Decoded in your browser to draw this — nothing has been uploaded yet."
                  : "This runs on a Lambda that cold-starts occasionally — a first run can take a few seconds longer than the rest. You can leave the tab open."}
              </p>
            </>
          )}

          {status === "done" && result && (
            <>
              {/* Hidden native element: it is the actual player, driven by the
                * transport below so the controls match the rest of the page. */}
              <audio
                ref={audioRef}
                src={result.downloadUrl}
                loop
                className="hidden"
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              />
              <div className="mt-[18px] flex items-center gap-[18px]">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? "Pause" : "Play"}
                  className="flex h-11 w-11 shrink-0 items-center justify-center bg-fg text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
                >
                  {playing ? (
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z" />
                    </svg>
                  ) : (
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7 4.5v15l13-7.5z" />
                    </svg>
                  )}
                </button>
                <p className="font-mono text-[0.8125rem] text-muted">
                  {formatTime(progress * playerDuration)} / {formatTime(playerDuration)}
                </p>
                <span className="inline-flex items-center gap-[7px] border border-accent px-2.5 py-[5px] text-[0.6875rem] uppercase tracking-[0.16em] text-accent">
                  <svg
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 9a4 4 0 0 1 4-4h11" />
                    <path d="m16 2 3 3-3 3" />
                    <path d="M20 15a4 4 0 0 1-4 4H5" />
                    <path d="m8 22-3-3 3-3" />
                  </svg>
                  Looping
                </span>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-5">
                <a
                  href={result.downloadUrl}
                  download
                  className="inline-flex min-h-11 items-center gap-2.5 bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
                >
                  <svg
                    aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 4v12" />
                    <path d="m7.5 11.5 4.5 4.5 4.5-4.5" />
                    <path d="M4 20h16" />
                  </svg>
                  Download the loop
                </a>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex min-h-11 items-center border-b border-line pb-0.5 text-[0.6875rem] uppercase tracking-[0.16em] text-muted transition-colors duration-200 ease-out hover:border-accent hover:text-fg motion-reduce:transition-none"
                >
                  Loop another track
                </button>
              </div>

              <p className="mt-5 text-[0.8125rem] text-muted">
                {expiresIn === 0
                  ? "This download link has expired — loop the track again for a fresh one."
                  : `This download link expires in ${formatTime(expiresIn ?? 0)}.`}{" "}
                The file itself is deleted within 24 hours.
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div
                role="alert"
                className="mt-7 flex flex-col gap-2 border-l-2 border-peak py-0.5 pl-4"
              >
                <div className="flex items-center gap-2.5 text-peak">
                  <svg
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v6" />
                    <path d="M12 16.5v.01" />
                  </svg>
                  <p className="text-[0.9375rem] font-semibold tracking-tight">{error}</p>
                </div>
                <p className="max-w-[52ch] text-sm leading-relaxed text-muted">
                  No loop came back. Your file is still on this page — try it again, or pick
                  a different one. Anything that reached the bucket is deleted within 24
                  hours either way.
                </p>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-5">
                <button
                  type="button"
                  onClick={() => file && handleFile(file)}
                  className="inline-flex min-h-11 items-center gap-2.5 bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
                >
                  Try this file again
                </button>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex min-h-11 items-center border-b border-line pb-0.5 text-[0.6875rem] uppercase tracking-[0.16em] text-muted transition-colors duration-200 ease-out hover:border-accent hover:text-fg motion-reduce:transition-none"
                >
                  Choose a different file
                </button>
              </div>
            </>
          )}

          {(status === "idle" || status === "error") && (
            <div
              data-testid="drop-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) handleFile(dropped);
              }}
              className="mt-9 flex flex-col items-center gap-5 border border-dashed border-line bg-surface px-10 py-11"
            >
              <svg
                aria-hidden="true"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-accent"
              >
                <path d="M12 16V4" />
                <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
                <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
              </svg>
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-[1.0625rem] font-medium tracking-tight">Drop a track here</p>
                <p className="text-[0.8125rem] text-muted">
                  WAV, MP3, FLAC or M4A — one file at a time
                </p>
              </div>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="min-h-11 bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
              >
                Choose a file
              </button>
            </div>
          )}

          <label htmlFor="bgm-file" className="sr-only">
            Choose a BGM file
          </label>
          <input
            id="bgm-file"
            ref={inputRef}
            type="file"
            accept="audio/*"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              // Cleared so picking the SAME track again still fires change —
              // otherwise "Loop another track" is dead for the one file you
              // most want to re-run once its download link has expired.
              e.target.value = "";
              if (picked) handleFile(picked);
            }}
          />

          {status === "idle" && (
            <p className="mt-[18px] flex items-center gap-2 text-[0.8125rem] text-muted">
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v.01" />
                <path d="M12 11v5" />
              </svg>
              Your upload and the looped result are deleted within 24 hours. Download links
              stay live for five minutes.
            </p>
          )}
        </div>

        <div className="col-span-12 lg:col-span-5 lg:pl-10">
          {status === "done" && result?.hasMetadata ? (
            <>
              <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
                What the pipeline decided
              </p>
              <dl className="mt-4">
                {[
                  {
                    label: "Cut from",
                    value:
                      result.loopStartSec === null || result.loopEndSec === null
                        ? "whole track"
                        : `${formatTime(result.loopStartSec)} → ${formatTime(result.loopEndSec)}`,
                  },
                  {
                    label: "Tempo used",
                    value:
                      result.tempoBpm === null ? "no beat grid found" : `${result.tempoBpm} BPM`,
                  },
                  { label: "Crossfade", value: `${result.crossfadeMs} ms equal-power` },
                  { label: "Output level", value: `−${Math.abs(result.targetLufs)} LUFS` },
                ].map((row, i, rows) => (
                  <div
                    key={row.label}
                    className={`flex items-baseline justify-between gap-4 border-t border-line py-3.5 ${
                      i === rows.length - 1 ? "border-b" : ""
                    }`}
                  >
                    <dt className="text-sm text-muted">{row.label}</dt>
                    <dd className="font-mono text-sm">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 max-w-[38ch] text-xs leading-relaxed text-muted">
                All four come back from the pipeline with the peak data that drew the waveform —
                the bars are the file you are about to download.
              </p>
            </>
          ) : (
            <>
              <p className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
                What happens to your file
              </p>
              <div className="mt-4 flex flex-col">
                {STEPS.map((step, i, steps) => {
                  const state =
                    stepIndex < 0 ? "pending" : i < stepIndex ? "done" : i === stepIndex ? "running" : "pending";
                  return (
                    <div
                      key={step.id}
                      className={`flex gap-4 border-t border-line py-[18px] ${
                        i === steps.length - 1 ? "border-b" : ""
                      } ${state === "running" ? "bg-accent/[0.07]" : ""} ${
                        state === "pending" && stepIndex >= 0 ? "opacity-55" : ""
                      }`}
                    >
                      <span
                        className={`w-7 shrink-0 pt-[3px] text-[0.6875rem] uppercase tracking-[0.16em] ${
                          state === "pending" ? "text-muted" : "text-accent"
                        }`}
                      >
                        0{i + 1}
                      </span>
                      <div className="flex grow flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-[0.9375rem] font-semibold tracking-tight">
                            {step.title}
                          </p>
                          {state === "running" && (
                            <span className="shrink-0 text-[0.6875rem] uppercase tracking-[0.16em] text-accent">
                              Running
                            </span>
                          )}
                          {state === "done" && (
                            <svg
                              aria-hidden="true"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="shrink-0 text-accent"
                            >
                              <path d="M4 12.5 9.5 18 20 7" />
                            </svg>
                          )}
                        </div>
                        <p className="max-w-[38ch] text-[0.8125rem] leading-relaxed text-muted">
                          {step.detail}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>

      {/* The tool sits outside the (site) group, so ⌘K is rendered here rather
        * than inherited — same as the login gate. */}
      <CommandBar />
    </div>
  );
}

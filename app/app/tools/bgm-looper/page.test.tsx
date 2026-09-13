import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Home from "./page";
import { toLoopResult } from "../../../lib/looper";

// jsdom has no Web Audio, so the browser-side decode is stubbed. The peaks it
// would produce are exercised directly in lib/peaks.test.ts.
const decodePeaks = vi.hoisted(() =>
  vi.fn(async (): Promise<number[] | null> => [0.5, 1, 0.25, 0.75]),
);
vi.mock("../../../lib/decode-audio", () => ({ decodePeaks }));

// CommandBar (rendered here because the tool sits outside the (site) group)
// calls useRouter, which has no app router mounted under jsdom.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const RESULT = {
  downloadUrl: "https://s3/download",
  expiresAt: "2026-09-11T10:05:00.000Z",
  peaks: [0.2, 0.4, 0.6, 0.8, 1],
  durationSec: 158.2,
  sampleRate: 48000,
  channels: 2,
  tempoBpm: 96,
  loopStartSec: 4.5,
  loopEndSec: 162.7,
  crossfadeMs: 50,
  targetLufs: -14,
  hasMetadata: true,
};

function mockFetchSequence(result: unknown = RESULT) {
  return vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
    })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: true, json: async () => result });
}

function chooseFile() {
  const file = new File(["bytes"], "song.mp3", { type: "audio/mpeg" });
  const input = screen.getByLabelText(/choose/i, { selector: "input" }) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe("BGM Looper page", () => {
  beforeEach(() => {
    decodePeaks.mockClear();
    decodePeaks.mockResolvedValue([0.5, 1, 0.25, 0.75]);
    vi.stubGlobal("fetch", mockFetchSequence());
  });

  it("uploads, processes, and offers the loop for download", async () => {
    render(<Home />);
    chooseFile();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
        "href",
        "https://s3/download",
      );
    });
    const audio = document.querySelector("audio")!;
    expect(audio).toHaveAttribute("src", "https://s3/download");
    expect(audio).toHaveAttribute("loop");
  });

  it("draws the result waveform from the peaks the pipeline returned", async () => {
    render(<Home />);
    chooseFile();

    await waitFor(() => {
      expect(document.querySelectorAll("[data-bar]")).toHaveLength(RESULT.peaks.length);
    });
  });

  it("reports what the pipeline decided", async () => {
    render(<Home />);
    chooseFile();

    await waitFor(() => expect(screen.getByText(/96 BPM/)).toBeInTheDocument());
    expect(screen.getByText(/50 ms equal-power/)).toBeInTheDocument();
    expect(screen.getByText(/−14 LUFS/)).toBeInTheDocument();
  });

  it("names the chosen file while it is being worked on", async () => {
    render(<Home />);
    chooseFile();

    expect(await screen.findByText("song.mp3")).toBeInTheDocument();
  });

  it("draws the locally decoded waveform before the result arrives", async () => {
    render(<Home />);
    chooseFile();

    await waitFor(() => expect(decodePeaks).toHaveBeenCalled());
    await waitFor(() => {
      expect(document.querySelectorAll("[data-bar]").length).toBeGreaterThan(0);
    });
  });

  it("carries on when the browser cannot decode the file", async () => {
    decodePeaks.mockResolvedValue(null);

    render(<Home />);
    chooseFile();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
    });
  });

  it("starts the same flow when a file is dropped on the drop zone", async () => {
    render(<Home />);
    const file = new File(["bytes"], "dropped.mp3", { type: "audio/mpeg" });

    fireEvent.drop(screen.getByTestId("drop-zone"), {
      dataTransfer: { files: [file], types: ["Files"] },
    });

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
    });
  });

  it("drops the previous track's waveform as soon as a new file is chosen", async () => {
    render(<Home />);
    chooseFile();
    await waitFor(() => {
      expect(document.querySelectorAll("[data-bar]")).toHaveLength(RESULT.peaks.length);
    });

    // A large file can spend seconds in decodeAudioData; the bars must not keep
    // showing the finished track under the new file's name.
    vi.stubGlobal("fetch", mockFetchSequence());
    decodePeaks.mockReturnValue(new Promise(() => {}));
    const second = new File(["bytes"], "second.mp3", { type: "audio/mpeg" });
    const input = screen.getByLabelText(/choose/i, { selector: "input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [second] } });

    await waitFor(() => expect(document.querySelectorAll("[data-bar]")).toHaveLength(0));
  });

  it("clears the file input so the same track can be run again", async () => {
    render(<Home />);
    chooseFile();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
    });
    const input = screen.getByLabelText(/choose/i, { selector: "input" }) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("keeps working against a pipeline that reports no metadata", async () => {
    // The deploy window where the app is new and the Lambda image is not: the
    // route still answers, through the same mapper, from a bare output key.
    vi.stubGlobal(
      "fetch",
      mockFetchSequence(
        toLoopResult(
          { output_key: "outputs/abc.wav" },
          "https://s3/download",
          "2026-09-11T10:05:00.000Z",
        ),
      ),
    );

    render(<Home />);
    chooseFile();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
    });
    // No fabricated zeros: the decisions panel is absent rather than claiming
    // 0 BPM and −0 LUFS.
    expect(screen.queryByText("Tempo used")).not.toBeInTheDocument();
    expect(screen.queryByText("Output level")).not.toBeInTheDocument();
  });

  it("stays on Play when the browser refuses to play the track", async () => {
    render(<Home />);
    chooseFile();
    await waitFor(() => expect(document.querySelector("audio")).toBeInTheDocument());

    // An expired presigned link 403s, so play() rejects.
    const audio = document.querySelector("audio")!;
    vi.spyOn(audio, "play").mockRejectedValue(new DOMException("Failed to fetch"));

    fireEvent.click(screen.getByRole("button", { name: /play/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /play/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
  });

  it("says the tempo was never found rather than printing the fallback", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchSequence({ ...RESULT, loopStartSec: null, loopEndSec: null, tempoBpm: null }),
    );

    render(<Home />);
    chooseFile();

    await waitFor(() => expect(screen.getByText("Tempo used")).toBeInTheDocument());
    expect(screen.getByText("no beat grid found")).toBeInTheDocument();
    expect(screen.getByText("whole track")).toBeInTheDocument();
    expect(screen.queryByText(/BPM/)).not.toBeInTheDocument();
  });

  it("shows an error message when processing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false }),
    );

    render(<Home />);
    chooseFile();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // The upload succeeded before processing failed, so the file IS in the
    // bucket — the copy has to say when it goes away, not that nothing was kept.
    expect(screen.getByRole("alert")).toHaveTextContent(/deleted within 24 hours/i);
  });

  it("offers the failed file again after an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ key: "uploads/abc.mp3", uploadUrl: "https://s3/upload" }),
        })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false }),
    );

    render(<Home />);
    chooseFile();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    vi.stubGlobal("fetch", mockFetchSequence());
    fireEvent.click(screen.getByRole("button", { name: /try this file again/i }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
    });
  });
});

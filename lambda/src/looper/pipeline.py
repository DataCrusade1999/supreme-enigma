import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

from looper.crossfade import crossfade_loop, fade_length
from looper.loop_point import beat_grid, find_loop_point
from looper.loudness import normalize_loudness
from looper.trim import trim_silence

# Bars in the waveform the page draws from `peaks`. Fixed here rather than
# passed in, so every result is the same shape whatever the track's length.
PEAK_COUNT = 240


def peaks(y: np.ndarray, count: int = PEAK_COUNT) -> list[float]:
    """Bar heights for the result waveform: per-bucket absolute peak, 0-1.

    Scaled against the loudest bucket rather than full scale, so the drawn
    waveform fills its frame the way an editor's does.
    """
    mono = np.abs(y).max(axis=1) if y.ndim == 2 else np.abs(y)
    pad = (-len(mono)) % count
    if pad:
        mono = np.concatenate([mono, np.zeros(pad)])
    buckets = mono.reshape(count, -1).max(axis=1)

    loudest = float(buckets.max())
    if loudest > 0:
        buckets = buckets / loudest
    return [round(float(v), 4) for v in buckets]


def process(input_path: str, output_path: str, target_lufs: float = -14.0) -> dict:
    """Loop `input_path` into `output_path` and describe what was decided.

    The returned dict is handed to the browser through the API, so every value
    in it is a plain Python scalar or list — numpy types don't survive Lambda's
    JSON encoding.
    """
    y, sr = sf.read(input_path, always_2d=True)
    mono = np.mean(y, axis=1)

    start, end = trim_silence(mono, top_db=40.0)
    y = y[start:end]

    y = normalize_loudness(y, sr, target_lufs=target_lufs)
    mono = np.mean(y, axis=1)

    tempo, beats = beat_grid(mono, sr)
    loop = find_loop_point(mono, sr, beats=beats)
    # No usable beat grid: the whole (trimmed) track becomes the loop, and the
    # page is told there were no loop bounds to report rather than being handed
    # the fallback as if it were a decision.
    found = loop is not None
    loop_start, loop_end = loop if found else (0, len(mono))

    y = crossfade_loop(y, loop_start, loop_end, sr)

    tmp_fd, tmp_wav = tempfile.mkstemp(suffix=".wav")
    os.close(tmp_fd)
    try:
        sf.write(tmp_wav, y, sr, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-i", tmp_wav, output_path], check=True, capture_output=True)
    finally:
        os.remove(tmp_wav)

    return {
        "peaks": peaks(y),
        "duration_sec": round(len(y) / sr, 3),
        "sample_rate": int(sr),
        "channels": int(y.shape[1]),
        "tempo_bpm": round(tempo, 1),
        "loop_start_sec": round(loop_start / sr, 3) if found else None,
        "loop_end_sec": round(loop_end / sr, 3) if found else None,
        "crossfade_ms": round(fade_length(loop_end - loop_start, sr) / sr * 1000, 1),
        "target_lufs": target_lufs,
    }

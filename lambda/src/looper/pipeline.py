import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

from looper.crossfade import crossfade_loop
from looper.loop_point import find_loop_point
from looper.loudness import normalize_loudness
from looper.trim import trim_silence


def process(input_path: str, output_path: str, target_lufs: float = -14.0) -> None:
    y, sr = sf.read(input_path, always_2d=True)
    mono = np.mean(y, axis=1)

    start, end = trim_silence(mono, top_db=40.0)
    y = y[start:end]

    y = normalize_loudness(y, sr, target_lufs=target_lufs)
    mono = np.mean(y, axis=1)

    loop = find_loop_point(mono, sr)
    if loop is None:
        loop = (0, len(mono))
    loop_start, loop_end = loop

    y = crossfade_loop(y, loop_start, loop_end, sr)

    tmp_fd, tmp_wav = tempfile.mkstemp(suffix=".wav")
    os.close(tmp_fd)
    try:
        sf.write(tmp_wav, y, sr, subtype="PCM_16")
        subprocess.run(["ffmpeg", "-y", "-i", tmp_wav, output_path], check=True, capture_output=True)
    finally:
        os.remove(tmp_wav)

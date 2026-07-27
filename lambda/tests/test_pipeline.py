import os
import numpy as np
import soundfile as sf
from looper.pipeline import process


def _write_fixture(path: str, sr: int = 22050, bpm: int = 120, n_beats: int = 16):
    beat_sec = 60 / bpm
    duration = beat_sec * n_beats
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    mono = 0.2 * np.sin(2 * np.pi * 220 * t)
    for i in range(n_beats):
        beat_start = i * beat_sec
        click = (t >= beat_start) & (t < beat_start + 0.05)
        mono[click] += 0.3 * np.sin(2 * np.pi * 880 * (t[click] - beat_start))
    stereo = np.stack([mono, mono], axis=1)
    sf.write(path, stereo, sr, subtype="PCM_16")


def test_process_produces_shorter_looped_wav(tmp_path):
    input_path = str(tmp_path / "input.wav")
    output_path = str(tmp_path / "output.wav")
    _write_fixture(input_path)

    process(input_path, output_path)

    assert os.path.exists(output_path)
    in_info = sf.info(input_path)
    out_info = sf.info(output_path)
    assert out_info.samplerate == in_info.samplerate
    assert out_info.channels == in_info.channels
    assert out_info.frames < in_info.frames
    assert out_info.frames > 0

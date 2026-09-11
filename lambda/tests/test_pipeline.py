import json
import os
import numpy as np
import soundfile as sf
from looper.pipeline import PEAK_COUNT, process


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


def _write_noise_fixture(path: str, sr: int = 22050, duration: float = 0.6):
    # Unstructured noise, too short/beat-less for find_loop_point to detect
    # 2+ beats, so process() must fall through to the (0, len(mono)) fallback.
    rng = np.random.default_rng(42)
    mono = 0.05 * rng.standard_normal(int(sr * duration))
    stereo = np.stack([mono, mono], axis=1)
    sf.write(path, stereo, sr, subtype="PCM_16")


def test_process_returns_json_serializable_metadata(tmp_path):
    input_path = str(tmp_path / "input.wav")
    output_path = str(tmp_path / "output.wav")
    _write_fixture(input_path)

    meta = process(input_path, output_path)

    # The page draws the result waveform from these, so they have to survive
    # Lambda's JSON encoder — no numpy scalars, no ndarrays.
    json.dumps(meta)

    assert len(meta["peaks"]) == PEAK_COUNT
    assert all(0.0 <= p <= 1.0 for p in meta["peaks"])
    assert meta["duration_sec"] > 0
    assert meta["sample_rate"] == sf.info(output_path).samplerate
    assert meta["crossfade_ms"] > 0
    assert meta["target_lufs"] == -14.0
    assert meta["tempo_bpm"] > 0
    assert 0 <= meta["loop_start_sec"] < meta["loop_end_sec"]


def test_process_reports_no_loop_point_as_null_metadata(tmp_path):
    input_path = str(tmp_path / "input.wav")
    output_path = str(tmp_path / "output.wav")
    _write_noise_fixture(input_path)

    meta = process(input_path, output_path)

    json.dumps(meta)
    assert meta["loop_start_sec"] is None
    assert meta["loop_end_sec"] is None
    # The tempo that produced no usable beat grid is not a decision either —
    # reporting it would contradict the null loop bounds next to it.
    assert meta["tempo_bpm"] is None
    assert len(meta["peaks"]) == PEAK_COUNT


def test_process_handles_no_loop_point_found(tmp_path):
    input_path = str(tmp_path / "input.wav")
    output_path = str(tmp_path / "output.wav")
    _write_noise_fixture(input_path)

    process(input_path, output_path)

    assert os.path.exists(output_path)
    out_info = sf.info(output_path)
    assert out_info.frames > 0

import numpy as np
from looper.loop_point import find_loop_point


def test_finds_loop_point_in_repeating_beat_pattern():
    sr = 22050
    bpm = 120
    beat_sec = 60 / bpm
    n_beats = 16
    duration = beat_sec * n_beats
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)

    mono = np.zeros_like(t)
    for i in range(n_beats):
        beat_start = i * beat_sec
        click = (t >= beat_start) & (t < beat_start + 0.05)
        mono[click] += np.sin(2 * np.pi * 440 * (t[click] - beat_start))

    result = find_loop_point(mono, sr, min_loop_sec=1.0, window_sec=0.05)

    assert result is not None
    start, end = result
    assert 0 <= start < end <= len(mono)
    assert (end - start) >= int(1.0 * sr)


def test_returns_none_with_no_beats():
    sr = 22050
    mono = np.zeros(sr, dtype=np.float64)

    result = find_loop_point(mono, sr)

    assert result is None

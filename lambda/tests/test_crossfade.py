import numpy as np
from looper.crossfade import crossfade_loop


def test_crossfade_output_length_mono():
    sr = 44100
    y = np.random.RandomState(0).uniform(-0.5, 0.5, sr * 2)

    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=0.05)

    fade_len = int(0.05 * sr)
    assert len(out) == sr - fade_len


def test_crossfade_no_nan_or_clipping():
    sr = 44100
    y = np.random.RandomState(1).uniform(-0.9, 0.9, sr * 2)

    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=0.05)

    assert not np.isnan(out).any()
    assert np.max(np.abs(out)) <= 1.0 + 1e-6


def test_crossfade_preserves_stereo_shape():
    sr = 44100
    mono = np.random.RandomState(2).uniform(-0.5, 0.5, sr * 2)
    y = np.stack([mono, mono * 0.8], axis=1)

    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=0.05)

    fade_len = int(0.05 * sr)
    assert out.shape == (sr - fade_len, 2)

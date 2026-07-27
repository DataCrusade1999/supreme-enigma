import numpy as np
import pyloudnorm as pyln
from looper.loudness import normalize_loudness


def test_normalize_reaches_target_lufs():
    sr = 44100
    t = np.linspace(0, 3, sr * 3, endpoint=False)
    y = (0.05 * np.sin(2 * np.pi * 440 * t)).astype(np.float64)

    out = normalize_loudness(y, sr, target_lufs=-14.0)

    meter = pyln.Meter(sr)
    measured = meter.integrated_loudness(out)
    assert abs(measured - (-14.0)) < 0.5


def test_normalize_never_clips_above_ceiling():
    sr = 44100
    t = np.linspace(0, 3, sr * 3, endpoint=False)
    y = (0.9 * np.sin(2 * np.pi * 440 * t)).astype(np.float64)

    out = normalize_loudness(y, sr, target_lufs=-6.0, true_peak_ceiling_db=-1.0)

    ceiling = 10 ** (-1.0 / 20)
    assert np.max(np.abs(out)) <= ceiling + 1e-6


def test_normalize_preserves_stereo_shape():
    sr = 44100
    t = np.linspace(0, 2, sr * 2, endpoint=False)
    mono = 0.05 * np.sin(2 * np.pi * 440 * t)
    y = np.stack([mono, mono], axis=1)

    out = normalize_loudness(y, sr)

    assert out.shape == y.shape

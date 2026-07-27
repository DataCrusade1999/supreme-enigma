import numpy as np
from looper.trim import trim_silence


def test_trim_removes_leading_and_trailing_silence():
    sr = 44100
    silence = np.zeros(sr, dtype=np.float64)
    t = np.linspace(0, 2, sr * 2, endpoint=False)
    tone = 0.5 * np.sin(2 * np.pi * 440 * t)
    mono = np.concatenate([silence, tone, silence])

    start, end = trim_silence(mono, top_db=40.0)

    assert start > sr * 0.5
    assert end < len(mono) - sr * 0.5
    assert end > start

import numpy as np
import pyloudnorm as pyln


def normalize_loudness(
    y: np.ndarray,
    sr: int,
    target_lufs: float = -14.0,
    true_peak_ceiling_db: float = -1.0,
) -> np.ndarray:
    meter = pyln.Meter(sr)
    loudness = meter.integrated_loudness(y)
    gain_db = target_lufs - loudness
    gain = 10 ** (gain_db / 20)
    y_norm = y * gain

    peak = np.max(np.abs(y_norm))
    ceiling = 10 ** (true_peak_ceiling_db / 20)
    if peak > ceiling:
        y_norm = y_norm * (ceiling / peak)

    return y_norm

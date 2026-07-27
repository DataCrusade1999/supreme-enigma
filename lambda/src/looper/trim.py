import librosa
import numpy as np


def trim_silence(mono: np.ndarray, top_db: float = 40.0) -> tuple[int, int]:
    _, index = librosa.effects.trim(mono, top_db=top_db)
    return int(index[0]), int(index[1])

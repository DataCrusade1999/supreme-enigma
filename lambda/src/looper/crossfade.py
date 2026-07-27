import numpy as np


def crossfade_loop(
    y: np.ndarray,
    start: int,
    end: int,
    sr: int,
    fade_sec: float = 0.05,
) -> np.ndarray:
    loop = y[start:end]
    fade_len = min(int(fade_sec * sr), len(loop) // 2)

    t = np.linspace(0, np.pi / 2, fade_len)
    fade_out = np.cos(t) / np.sqrt(2)
    fade_in = np.sin(t) / np.sqrt(2)

    if loop.ndim == 2:
        fade_out = fade_out[:, None]
        fade_in = fade_in[:, None]

    head = loop[:fade_len]
    tail = loop[-fade_len:]
    blended = tail * fade_out + head * fade_in

    return np.concatenate([blended, loop[fade_len:-fade_len]], axis=0)

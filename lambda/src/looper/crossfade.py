import numpy as np


def fade_length(loop_len: int, sr: int, fade_sec: float = 0.05) -> int:
    """Samples of crossfade a loop of `loop_len` actually gets.

    A loop shorter than two nominal fades gets half its own length instead, so
    the pipeline reports this rather than the nominal `fade_sec`.
    """
    return min(int(fade_sec * sr), loop_len // 2)


def crossfade_loop(
    y: np.ndarray,
    start: int,
    end: int,
    sr: int,
    fade_sec: float = 0.05,
) -> np.ndarray:
    loop = y[start:end]
    fade_len = fade_length(len(loop), sr, fade_sec)

    t = np.linspace(0, np.pi / 2, fade_len)
    fade_out = np.cos(t)
    fade_in = np.sin(t)

    if loop.ndim == 2:
        fade_out = fade_out[:, None]
        fade_in = fade_in[:, None]

    head = loop[:fade_len]
    tail = loop[-fade_len:]
    blended = tail * fade_out + head * fade_in

    return np.concatenate([blended, loop[fade_len:-fade_len]], axis=0)

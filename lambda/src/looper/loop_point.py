import librosa
import numpy as np


def beat_grid(mono: np.ndarray, sr: int) -> tuple[float, np.ndarray]:
    """Estimated tempo and beat positions, in samples.

    Split out of find_loop_point so the pipeline can report the tempo without
    running the (expensive) beat tracker a second time. librosa hands the tempo
    back as an array; the API serializes it, so it is unwrapped to a float here.
    """
    tempo, beat_frames = librosa.beat.beat_track(y=mono, sr=sr, units="frames")
    return float(np.atleast_1d(tempo)[0]), librosa.frames_to_samples(beat_frames)


def find_loop_point(
    mono: np.ndarray,
    sr: int,
    min_loop_sec: float = 2.0,
    window_sec: float = 0.05,
    beats: np.ndarray | None = None,
) -> tuple[int, int] | None:
    if beats is None:
        _, beats = beat_grid(mono, sr)
    if len(beats) < 2:
        return None

    w = int(window_sec * sr)
    min_len = int(min_loop_sec * sr)
    n = len(mono)

    best: tuple[int, int] | None = None
    best_score = -1.0

    for bi, i in enumerate(beats):
        if i + w > n:
            continue
        head = mono[i : i + w]
        head_norm = np.linalg.norm(head)
        if head_norm == 0:
            continue

        for j in beats[bi + 1 :]:
            if j - i < min_len:
                continue
            if j + w > n:
                break
            tail = mono[j : j + w]
            tail_norm = np.linalg.norm(tail)
            if tail_norm == 0:
                continue

            score = float(np.dot(head, tail) / (head_norm * tail_norm))
            if score > best_score:
                best_score = score
                best = (int(i), int(j))

    return best

import librosa
import numpy as np


def find_loop_point(
    mono: np.ndarray,
    sr: int,
    min_loop_sec: float = 2.0,
    window_sec: float = 0.05,
) -> tuple[int, int] | None:
    _, beat_frames = librosa.beat.beat_track(y=mono, sr=sr, units="frames")
    beats = librosa.frames_to_samples(beat_frames)
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

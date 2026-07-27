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
    # Use input range [-0.7, 0.7] so that the equal-power crossfade output
    # (which can amplify by up to sqrt(2) in the crossfade region) stays within [-1, 1]
    y = np.random.RandomState(1).uniform(-0.7, 0.7, sr * 2)

    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=0.05)

    assert not np.isnan(out).any()
    # Maximum output in equal-power crossfade is input_max * sqrt(2) ≈ 0.7 * 1.414 ≈ 0.99
    assert np.max(np.abs(out)) <= 1.0 + 1e-6


def test_crossfade_preserves_stereo_shape():
    sr = 44100
    mono = np.random.RandomState(2).uniform(-0.5, 0.5, sr * 2)
    y = np.stack([mono, mono * 0.8], axis=1)

    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=0.05)

    fade_len = int(0.05 * sr)
    assert out.shape == (sr - fade_len, 2)


def test_crossfade_preserves_power():
    """Verify that crossfade preserves loudness (RMS) through the transition.

    Creates two decorrelated signals (different noise with same amplitude) for head/tail,
    runs crossfade, and checks that the RMS of the blended region is close to the surrounding
    un-faded audio. This catches the bug where / np.sqrt(2) scaling caused a -3dB power dip.
    """
    sr = 44100
    fade_sec = 0.05
    fade_len = int(fade_sec * sr)

    # Create decorrelated signals: head uses one seed, tail uses another
    # Both are normalized to roughly the same amplitude range
    head_noise = np.random.RandomState(10).uniform(-0.5, 0.5, fade_len)
    tail_noise = np.random.RandomState(11).uniform(-0.5, 0.5, fade_len)
    middle = np.random.RandomState(12).uniform(-0.5, 0.5, sr - 2 * fade_len)

    # Construct the loop: head + middle + tail
    y = np.concatenate([head_noise, middle, tail_noise])

    # Run crossfade
    out = crossfade_loop(y, start=0, end=sr, sr=sr, fade_sec=fade_sec)

    # The blended region is the first fade_len samples of the output
    blended = out[:fade_len]

    # The surrounding un-faded audio is the middle section (no fading applied)
    surrounding = out[fade_len:-fade_len] if len(out) > 2 * fade_len else out[fade_len:]

    # Calculate RMS
    rms_blended = np.sqrt(np.mean(blended ** 2))
    rms_surrounding = np.sqrt(np.mean(surrounding ** 2))

    # Allow 15% tolerance for the RMS (to account for variance in random signals)
    # The blended region should be close to the surrounding in loudness
    if rms_surrounding > 0:
        rms_ratio = rms_blended / rms_surrounding
        assert 0.85 <= rms_ratio <= 1.15, \
            f"RMS ratio {rms_ratio:.3f} outside tolerance; power was not preserved"

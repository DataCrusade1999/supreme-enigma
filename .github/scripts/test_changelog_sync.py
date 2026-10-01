"""Tests for changelog-sync.py and changelog-release.py.

Run in CI by deploy.yml's `unit` job. The scripts are invoked as subprocesses
rather than imported: their hyphenated filenames are not importable, and the
exit codes are part of what deploy.yml relies on.
"""

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).parent
RELEASE = SCRIPTS / "changelog-release.py"
SYNC = SCRIPTS / "changelog-sync.py"

HEADER = "# Changelog\n\nAll notable changes are documented here.\n\n"
OLDER = "## [1.0.0] - 2026-01-01\n\n### Added\n\n- the first thing\n"


def run(script, *args):
    return subprocess.run(
        [sys.executable, str(script), *map(str, args)], capture_output=True, text=True
    )


def write(tmp_path, name, body):
    path = tmp_path / name
    path.write_text(textwrap.dedent(body), encoding="utf-8", newline="")
    return path


def released(unreleased_body, version="1.1.0"):
    """main's file after the release transform: [Unreleased] empty, body below."""
    return f"{HEADER}## [Unreleased]\n\n## [{version}] - 2026-02-01\n\n{unreleased_body}\n{OLDER}"


def dev(unreleased_body):
    return f"{HEADER}## [Unreleased]\n\n{unreleased_body}\n{OLDER}"


def sync(tmp_path, main_text, dev_text, version="1.1.0"):
    main_md = write(tmp_path, "main.md", main_text)
    dev_md = write(tmp_path, "dev.md", dev_text)
    out = tmp_path / "out.md"
    proc = run(SYNC, main_md, dev_md, version, out)
    return proc, out


BODY = "### Added\n\n- shipped entry\n"


def test_no_race_is_byte_identical_to_main(tmp_path):
    main_text = released(BODY)
    proc, out = sync(tmp_path, main_text, dev(BODY))
    assert proc.returncode == 0, proc.stderr
    assert out.read_text(encoding="utf-8") == main_text
    assert "kept=0" in proc.stdout


def test_race_in_existing_subsection_stays_unreleased(tmp_path):
    proc, out = sync(
        tmp_path, released(BODY), dev("### Added\n\n- shipped entry\n- raced entry\n")
    )
    assert proc.returncode == 0, proc.stderr
    assert "kept=1" in proc.stdout
    assert out.read_text(encoding="utf-8") == (
        f"{HEADER}## [Unreleased]\n\n### Added\n\n- raced entry\n\n"
        f"## [1.1.0] - 2026-02-01\n\n{BODY}\n{OLDER}"
    )


def test_race_in_new_subsection_keeps_its_heading(tmp_path):
    proc, out = sync(
        tmp_path, released(BODY), dev("### Added\n\n- shipped entry\n\n### Fixed\n\n- raced fix\n")
    )
    assert proc.returncode == 0, proc.stderr
    text = out.read_text(encoding="utf-8")
    assert "## [Unreleased]\n\n### Fixed\n\n- raced fix\n\n## [1.1.0]" in text
    assert "### Added" not in text.split("## [1.1.0]")[0]


def test_reflowed_entry_counts_as_shipped(tmp_path):
    proc, out = sync(
        tmp_path,
        released("### Added\n\n- one entry that was rewrapped on dev\n"),
        dev("### Added\n\n- one entry that was\n  rewrapped on dev\n"),
    )
    assert proc.returncode == 0, proc.stderr
    assert "kept=0" in proc.stdout
    assert out.read_text(encoding="utf-8") == released(
        "### Added\n\n- one entry that was rewrapped on dev\n"
    )


def test_same_text_under_a_different_heading_is_not_shipped(tmp_path):
    """An entry recategorized on dev is matched per subsection, not globally.
    Keying on text alone let main's `### Added` copy shadow dev's identical
    `### Fixed` one, emptying [Unreleased] with kept=0. It now stays, and
    main_only goes non-zero so the sync PR title tells a human to look."""
    text = "- the same sentence filed under two different headings\n"
    proc, out = sync(
        tmp_path, released(f"### Added\n\n{text}"), dev(f"### Fixed\n\n{text}")
    )
    assert proc.returncode == 0, proc.stderr
    assert "kept=1" in proc.stdout
    assert "main_only=1" in proc.stdout
    assert f"## [Unreleased]\n\n### Fixed\n\n{text}\n## [1.1.0]" in out.read_text(
        encoding="utf-8"
    )


def test_multi_line_raced_entry_is_preserved_verbatim(tmp_path):
    raced = "- a raced entry whose text\n  wraps across three\n  separate lines\n"
    proc, out = sync(tmp_path, released(BODY), dev(f"### Added\n\n- shipped entry\n{raced}"))
    assert proc.returncode == 0, proc.stderr
    assert raced in out.read_text(encoding="utf-8")


def test_entry_only_on_main_is_counted_not_dropped(tmp_path):
    main_text = released("### Added\n\n- shipped entry\n- hotfixed straight onto main\n")
    proc, out = sync(tmp_path, main_text, dev(BODY))
    assert proc.returncode == 0, proc.stderr
    assert "main_only=1" in proc.stdout
    assert out.read_text(encoding="utf-8") == main_text


def test_reworded_entry_appears_under_both_headings(tmp_path):
    """Pins the one case the script cannot resolve, so a refactor cannot quietly
    change what the reviewer is shown. An entry reworded on dev after the
    promotion does not match main's wording, so it stays under [Unreleased]
    while main's copy stays under the version - the same change listed twice.
    Which wording is authoritative is not something automation can decide; the
    signal that a human must look is main_only being non-zero, which the sync
    step puts in the PR title."""
    long = "- add a user profile page for authenticated users"
    short = "- add a user profile page"
    section = "### Added\n\n%s\n"
    proc, out = sync(tmp_path, released(section % long), dev(section % short))
    assert proc.returncode == 0, proc.stderr
    assert "kept=1" in proc.stdout
    assert "main_only=1" in proc.stdout
    text = out.read_text(encoding="utf-8")
    unreleased, _, version = text.partition("## [1.1.0]")
    assert short + "\n" in unreleased
    assert long in version


def test_missing_version_section_on_main_exits_2(tmp_path):
    proc, _ = sync(tmp_path, released(BODY, version="9.9.9"), dev(BODY))
    assert proc.returncode == 2
    assert "no heading matching" in proc.stderr


def test_non_empty_unreleased_on_main_exits_2(tmp_path):
    main_text = f"{HEADER}## [Unreleased]\n\n- leftover\n\n## [1.1.0] - 2026-02-01\n\n{BODY}\n{OLDER}"
    proc, _ = sync(tmp_path, main_text, dev(BODY))
    assert proc.returncode == 2
    assert "not empty" in proc.stderr


def test_unparseable_entry_exits_2(tmp_path):
    proc, _ = sync(tmp_path, released(BODY), dev("### Added\n\nloose prose line\n"))
    assert proc.returncode == 2
    assert "not a heading" in proc.stderr


@pytest.mark.parametrize("second_date", ["2026-02-01", "2026-02-02"])
def test_release_transform_inserts_one_heading_per_version(tmp_path, second_date):
    path = write(tmp_path, "CHANGELOG.md", dev(BODY))
    assert run(RELEASE, path, "1.1.0", "2026-02-01").returncode == 0
    proc = run(RELEASE, path, "1.1.0", second_date)
    assert proc.returncode == 0, proc.stderr
    assert path.read_text(encoding="utf-8").count("## [1.1.0]") == 1


def test_release_transform_exits_2_without_unreleased(tmp_path):
    path = write(tmp_path, "CHANGELOG.md", f"{HEADER}{OLDER}")
    proc = run(RELEASE, path, "1.1.0", "2026-02-01")
    assert proc.returncode == 2
    assert "no ## [Unreleased] heading found" in proc.stderr

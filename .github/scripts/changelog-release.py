#!/usr/bin/env python3
"""Insert a released-version heading under CHANGELOG.md's [Unreleased] heading.

Run by deploy.yml's `release` job against `main`, to turn the accumulated
[Unreleased] entries into the release's section. The matching edit on `dev` is
made by changelog-sync.py, which copies main's released section verbatim rather
than re-deriving it, so the two files cannot drift.

Idempotent by version, deliberately not by version+date: the `release` job can
re-run on a later day (a sync failure fails the job before the tag is created,
and the re-run is the recovery path), and a date-sensitive check would insert a
second heading for the same version on that re-run, filing the entries under
the stale copy. That is the #168 shape.

Exits 2 if the [Unreleased] heading is missing, so a malformed CHANGELOG.md
fails the step instead of silently doing nothing.
"""

import re
import sys

UNRELEASED = "## [Unreleased]"


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: changelog-release.py <path> <version> <date>", file=sys.stderr)
        return 2
    path, version, date = sys.argv[1:4]
    with open(path, encoding="utf-8") as f:
        content = f.read()
    if UNRELEASED not in content:
        print(f"{path}: no {UNRELEASED} heading found", file=sys.stderr)
        return 2
    if re.search(rf"^## \[{re.escape(version)}\]", content, re.MULTILINE):
        print(f"{path}: ## [{version}] already present, nothing to do")
        return 0
    heading = f"## [{version}] - {date}"
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content.replace(UNRELEASED, f"{UNRELEASED}\n\n{heading}", 1))
    print(f"{path}: inserted {heading}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

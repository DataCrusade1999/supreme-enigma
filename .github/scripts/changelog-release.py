#!/usr/bin/env python3
"""Insert a released-version heading under CHANGELOG.md's [Unreleased] heading.

Run by deploy.yml's `release` job twice per release, against the same version
and date, and it must produce byte-identical output both times:

  1. on `main`, to turn the accumulated [Unreleased] entries into the release's
     section, and
  2. on the `chore/changelog-sync-*` branch cut from `dev`, to reproduce that
     same edit there rather than replaying main's commit.

Replaying it (cherry-pick) is what issue #168 was: the replay conflicts against
dev's own [Unreleased] entries, and a copy of a commit has no ancestry, so the
next promotion's merge base still predates the heading and git re-inserts it.

Exits 2 if the [Unreleased] heading is missing, so a malformed CHANGELOG.md
fails the step instead of silently doing nothing.
"""

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
    heading = f"## [{version}] - {date}"
    if heading in content:
        print(f"{path}: {heading} already present, nothing to do")
        return 0
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(content.replace(UNRELEASED, f"{UNRELEASED}\n\n{heading}", 1))
    print(f"{path}: inserted {heading}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

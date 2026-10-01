#!/usr/bin/env python3
"""Build dev's CHANGELOG.md for the changelog-sync PR that follows a release.

Run by deploy.yml's `release` job on the branch cut from `dev`. Takes main's
CHANGELOG.md (which already carries the new version's section) and dev's, and
writes the file the sync PR should land.

The released section is copied from main verbatim rather than re-derived, so
the two files cannot drift. The only thing added is dev's *un-promoted*
[Unreleased] entries — the ones that landed on dev after the promotion and so
did not ship in this version. That set is dev's [Unreleased] body minus the
body main filed under the version: entries in both shipped, entries only on dev
did not. Filing the latter under the new heading is what issue #197 was.

With no un-promoted entries the output is byte-identical to main's file, which
is the ordinary case.

Exits 2 on anything it cannot parse or account for, so a malformed CHANGELOG.md
fails the step instead of producing a plausible-looking wrong file.
"""

import re
import sys

UNRELEASED = "## [Unreleased]"


def fail(msg):
    print(f"changelog-sync: {msg}", file=sys.stderr)
    sys.exit(2)


def section_body(lines, heading_pattern, label):
    """Lines under the first heading matching heading_pattern, up to the next `## `."""
    start = next(
        (i + 1 for i, line in enumerate(lines) if re.match(heading_pattern, line)), None
    )
    if start is None:
        fail(f"{label}: no heading matching {heading_pattern!r}")
    end = next(
        (j for j in range(start, len(lines)) if lines[j].startswith("## ")), len(lines)
    )
    return lines[start:end]


def parse(body, label):
    """-> [(### heading or None, [entry, ...])], entry being its original lines."""
    groups, head, entries, entry = [], None, [], None

    def end_entry():
        nonlocal entry
        if entry:
            entries.append(entry)
        entry = None

    def end_group():
        nonlocal head, entries
        end_entry()
        if head is not None or entries:
            groups.append((head, entries))
        head, entries = None, []

    for line in body:
        if line.startswith("### "):
            end_group()
            head = line
        elif line.startswith("- "):
            end_entry()
            entry = [line]
        elif not line.strip():
            end_entry()
        elif entry is not None:
            entry.append(line)
        else:
            fail(f"{label}: line is not a heading, an entry or a continuation: {line!r}")
    end_group()
    return groups


def norm(lines):
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def key(head, entry):
    """Match entries across branches ignoring how they happen to be wrapped.

    Keyed on the enclosing `###` heading as well as the text: identical wording
    under two different headings is a recategorization, not a shipped entry, and
    must not de-duplicate away.
    """
    return (norm([head]) if head is not None else None, norm(entry))


def render(groups):
    out = []
    for head, entries in groups:
        if out:
            out.append("")
        if head is not None:
            out += [head, ""]
        for entry in entries:
            out += entry
    return "\n".join(out)


def main() -> int:
    if len(sys.argv) != 5:
        print(
            "usage: changelog-sync.py <main.md> <dev.md> <version> <out>",
            file=sys.stderr,
        )
        return 2
    main_path, dev_path, version, out_path = sys.argv[1:5]
    with open(main_path, encoding="utf-8") as f:
        main_content = f.read()
    with open(dev_path, encoding="utf-8") as f:
        dev_lines = f.read().split("\n")
    main_lines = main_content.split("\n")

    version_heading = rf"^## \[{re.escape(version)}\]"
    released = parse(section_body(main_lines, version_heading, "main"), "main")
    if any(line.strip() for line in section_body(main_lines, rf"^{re.escape(UNRELEASED)}$", "main")):
        fail("main: [Unreleased] is not empty after the release transform")
    dev_unreleased = parse(
        section_body(dev_lines, rf"^{re.escape(UNRELEASED)}$", "dev"), "dev"
    )

    shipped = {key(head, e) for head, entries in released for e in entries}
    on_dev = {key(head, e) for head, entries in dev_unreleased for e in entries}
    remainder = [
        (head, kept)
        for head, entries in dev_unreleased
        if (kept := [e for e in entries if key(head, e) not in shipped])
    ]

    body = render(remainder)
    if body:
        out = main_content.replace(f"{UNRELEASED}\n", f"{UNRELEASED}\n\n{body}\n", 1)
    else:
        out = main_content
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        f.write(out)

    print(f"kept={sum(len(entries) for _, entries in remainder)}")
    print(f"main_only={len([k for k in shipped if k not in on_dev])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

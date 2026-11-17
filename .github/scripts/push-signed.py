"""Publish the local HEAD commit to a branch through GitHub's git-data API.

`git push` from the release job leaves its commits unsigned, so a branch that
requires signed commits rejects them (#373). A commit created through the API with
the job's token is signed by GitHub instead. The new commit keeps HEAD's tree,
message and every parent, so a merge stays a merge (the changelog-sync PR depends
on that, #168); its author is whoever owns GH_TOKEN (github-actions[bot] in CI).

Usage: python3 push-signed.py <branch> [--force]
Prints the new commit's SHA. Needs `gh` and GITHUB_REPOSITORY.
"""

import base64
import json
import os
import subprocess
import sys


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def api(path: str, body: dict | None = None, method: str = "POST") -> dict:
    cmd = ["gh", "api", "-X", method, path]
    if body is not None:
        cmd += ["--input", "-"]
    out = subprocess.run(cmd, check=True, capture_output=True, input=json.dumps(body or {}).encode())
    return json.loads(out.stdout) if out.stdout.strip() else {}


def tree_entries(first_parent: str) -> list[dict]:
    """Every path HEAD changes against its first parent, as git-data tree entries."""
    entries = []
    changes = git("diff", "--name-status", "--no-renames", "-z", first_parent, "HEAD").split(b"\0")
    for status, path in zip(changes[0::2], changes[1::2]):
        path = path.decode()
        if status == b"D":
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
            continue
        mode = git("ls-tree", "HEAD", "--", path).split()[0].decode()
        content = base64.b64encode(git("cat-file", "blob", f"HEAD:{path}")).decode()
        blob = api(f"repos/{REPO}/git/blobs", {"content": content, "encoding": "base64"})
        entries.append({"path": path, "mode": mode, "type": "blob", "sha": blob["sha"]})
    return entries


def main(branch: str, force: bool) -> str:
    parents = git("rev-list", "--parents", "-n1", "HEAD").decode().split()[1:]
    base_tree = git("rev-parse", f"{parents[0]}^{{tree}}").decode().strip()
    entries = tree_entries(parents[0])
    tree = api(f"repos/{REPO}/git/trees", {"base_tree": base_tree, "tree": entries})["sha"] if entries else base_tree
    expected = git("rev-parse", "HEAD^{tree}").decode().strip()
    if tree != expected:
        sys.exit(f"::error::the API built tree {tree}, but HEAD's tree is {expected}")

    message = git("log", "-1", "--format=%B", "HEAD").decode()
    commit = api(f"repos/{REPO}/git/commits", {"message": message, "tree": tree, "parents": parents})["sha"]

    exists = subprocess.run(
        ["git", "ls-remote", "--exit-code", "--heads", "origin", branch], capture_output=True
    ).returncode == 0
    if exists:
        api(f"repos/{REPO}/git/refs/heads/{branch}", {"sha": commit, "force": force}, method="PATCH")
    else:
        api(f"repos/{REPO}/git/refs", {"ref": f"refs/heads/{branch}", "sha": commit})

    verified = api(f"repos/{REPO}/git/commits/{commit}", method="GET")["verification"]["verified"]
    print(f"{branch} is at {commit} (signature verified: {verified})", file=sys.stderr)
    return commit


if __name__ == "__main__":
    REPO = os.environ["GITHUB_REPOSITORY"]
    print(main(sys.argv[1], "--force" in sys.argv[2:]))

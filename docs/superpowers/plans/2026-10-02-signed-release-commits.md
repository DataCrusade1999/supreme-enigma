# Signed Release Commits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every commit the `release` job writes is signed by GitHub, so a `required_signatures` ruleset can cover `dev`, `stage` and `main`.

**Architecture:** The `release` job keeps building its two commits locally with `git` exactly as it does now (the changelog commit on `main`, and the sync merge commit on `chore/changelog-sync-vX.Y.Z`). Only the publishing changes: instead of `git push`, a new script recreates the local commit through the REST git-data API (blobs → tree → commit) and moves the branch ref. GitHub signs commits created through the API with `GITHUB_TOKEN` when no author or committer is given. The script checks that the API-built tree has the same SHA as the local one and that GitHub marked the commit verified, and only then moves the ref.

**Tech Stack:** Node 20+ ES module with `node:test` (same as the other `.github/scripts/*.mjs`), GitHub REST git-data API, bash in `.github/workflows/deploy.yml`.

**Spec:** Issue #373. No separate design doc: the design is the issue plus this plan's Architecture section.

## Global Constraints

- Every `uses:` must be pinned to a 40-character SHA, and only allowlisted action owners run (`.claude/rules/ci.md`). This plan adds no actions; the release job calls `node` from the runner image, which ships Node 20+ with global `fetch`.
- The script is standalone: no imports from other `.github/scripts/` files, because the sync step runs it from `$RUNNER_TEMP` after checking out a branch cut from `dev`, whose tree may not contain it.
- The sync commit must keep both parents (`origin/dev`, `origin/main`). A single-parent sync commit re-creates #168.
- Every failure in the release job's publish path stays fatal. A failure before the tag is recovered by re-running the job (`docs/runbooks/stale-lambda-recovery.md`, `merging-a-pr` skill).
- Commit messages and PR titles use Conventional Commits; commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- `node --test ".github/scripts/*.test.mjs"` runs in the `test` job, so the new test file is picked up with no workflow change.

## Review Focus

- `main` moves between the job's checkout and the publish (another push lands): the ref update must be fast-forward-only and fail the step, not overwrite the new commit. Tested in Task 1 (`update mode never forces`).
- `CHANGELOG.md` with non-ASCII text or CRLF line endings: bytes must round-trip exactly. Blobs are sent base64 from `git cat-file`, and the tree-SHA check catches any drift. Tested in Task 1 (`blob content is sent as base64 of the exact bytes`).
- A merge that brings in deleted files or executable files from `main`: deletions must be sent as `sha: null` and modes preserved, or the tree SHA differs. Tested in Task 1 (`parseRawDiff`) and by the tree-SHA guard.
- Branch names with slashes (`chore/changelog-sync-v1.9.0`): the ref path must not be URL-encoded as a whole. Tested in Task 1 (`ref paths keep their slashes`).
- A re-run finds a leftover sync branch from an attempt that died before `gh pr create`: the existing authorship guard (`%an` = `github-actions[bot]`) must still recognise an API-created commit. Checked by the Actions dry run in Task 2b (`author=`) and again on the first real release in Task 4; if the name differs the step fails loudly, which is the safe direction.
- Other writers to `dev` once `required_signatures` is on: Keystatic (GitHub mode, blog content under `content/`), Dependabot, and a `workflow_dispatch` release on `main` that still runs the old `deploy.yml`. Any unsigned commit from them would be refused. Checked before the rule goes on in Task 4 Step 1.

---

## File Structure

- Create `.github/scripts/signed-commit.mjs`: parses `git diff --raw -z`, recreates a local commit through the API, moves the ref. One responsibility; exports pure helpers for tests and a CLI.
- Create `.github/scripts/signed-commit.test.mjs`: unit tests with a fake `git` and a fake `api`.
- Modify `.github/workflows/deploy.yml` (`release` job, steps "Commit CHANGELOG.md to main" and "Open changelog-sync PR to dev"): replace the three `git push` calls.
- Modify `.claude/rules/ci.md` and `.claude/skills/merging-a-pr/SKILL.md`: document the signed path and the ruleset.

---

### Task 1: `signed-commit.mjs`

**Files:**
- Create: `.github/scripts/signed-commit.mjs`
- Test: `.github/scripts/signed-commit.test.mjs`

**Interfaces:**
- Produces:
  - `parseRawDiff(out: string): Array<{ path: string, mode: string, sha: string | null }>`
  - `refPath(branch: string): string` → `"git/refs/heads/<branch>"`
  - `publish({ git, gitBuffer, api }, { commit: string, branch: string, mode: "update" | "create" | "force" }): Promise<string>` → the new commit SHA
  - CLI: `node signed-commit.mjs <commit> <branch> <update|create|force>` prints the new SHA on stdout. Needs `GITHUB_TOKEN`, `GITHUB_REPOSITORY`; `GITHUB_API_URL` defaults to `https://api.github.com`.

- [ ] **Step 1: Write the failing tests**

```js
// .github/scripts/signed-commit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRawDiff, refPath, publish } from "./signed-commit.mjs";

const Z = "\0";

test("parseRawDiff: modify, add, delete and an executable file", () => {
  const out =
    ":100644 100644 aaa1 bbb1 M" + Z + "CHANGELOG.md" + Z +
    ":000000 100644 0000 ccc1 A" + Z + "docs/new file.md" + Z +
    ":100644 000000 ddd1 0000 D" + Z + "old.txt" + Z +
    ":100644 100755 eee1 fff1 M" + Z + "tools/run.sh" + Z;
  assert.deepEqual(parseRawDiff(out), [
    { path: "CHANGELOG.md", mode: "100644", sha: "bbb1" },
    { path: "docs/new file.md", mode: "100644", sha: "ccc1" },
    { path: "old.txt", mode: "100644", sha: null },
    { path: "tools/run.sh", mode: "100755", sha: "fff1" },
  ]);
});

test("parseRawDiff: empty output is no entries", () => {
  assert.deepEqual(parseRawDiff(""), []);
});

test("ref paths keep their slashes", () => {
  assert.equal(refPath("chore/changelog-sync-v1.9.0"), "git/refs/heads/chore/changelog-sync-v1.9.0");
});

// A fake repo: one changed file on top of `parent` (or two parents for a merge).
function fakes({ parents = ["p1"], treeSha = "T", verified = true, apiTree } = {}) {
  const calls = [];
  const git = (args) => {
    const k = args.join(" ");
    if (k === "rev-list --parents -n 1 C") return ["C", ...parents].join(" ") + "\n";
    if (k === "log -1 --format=%B C") return "chore(changelog): release v1.9.0\n\n";
    if (k === "rev-parse C^{tree}") return "T\n";
    if (k === `rev-parse ${parents[0]}^{tree}`) return "BASE\n";
    if (k === `diff --raw -z --no-renames --no-abbrev ${parents[0]} C`)
      return ":100644 100644 old new M\0CHANGELOG.md\0:100644 000000 gone 0000 D\0x.txt\0";
    throw new Error("unexpected git " + k);
  };
  const gitBuffer = (args) => {
    assert.equal(args.join(" "), "cat-file blob new");
    return Buffer.from("## [1.9.0] – ünïcode\r\n", "utf8");
  };
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === "git/blobs") return { sha: "new" };
    if (path === "git/trees") return { sha: apiTree ?? treeSha };
    if (path === "git/commits") return { sha: "SIGNED", verification: { verified, reason: verified ? "valid" : "unsigned" } };
    return { object: { sha: "SIGNED" } };
  };
  return { git, gitBuffer, api, calls };
}

test("update mode: rebuilds the commit and fast-forwards the branch", async () => {
  const f = fakes();
  const sha = await publish(f, { commit: "C", branch: "main", mode: "update" });
  assert.equal(sha, "SIGNED");
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.path}`), [
    "POST git/blobs", "POST git/trees", "POST git/commits", "PATCH git/refs/heads/main",
  ]);
  assert.deepEqual(f.calls[1].body, {
    base_tree: "BASE",
    tree: [
      { path: "CHANGELOG.md", mode: "100644", type: "blob", sha: "new" },
      { path: "x.txt", mode: "100644", type: "blob", sha: null },
    ],
  });
  assert.deepEqual(f.calls[2].body, { message: "chore(changelog): release v1.9.0", tree: "T", parents: ["p1"] });
});

test("update mode never forces", async () => {
  const f = fakes();
  await publish(f, { commit: "C", branch: "main", mode: "update" });
  assert.deepEqual(f.calls[3].body, { sha: "SIGNED", force: false });
});

test("blob content is sent as base64 of the exact bytes", async () => {
  const f = fakes();
  await publish(f, { commit: "C", branch: "main", mode: "update" });
  assert.deepEqual(f.calls[0].body, {
    content: Buffer.from("## [1.9.0] – ünïcode\r\n", "utf8").toString("base64"),
    encoding: "base64",
  });
});

test("a merge commit keeps both parents and builds on the first parent's tree", async () => {
  const f = fakes({ parents: ["devsha", "mainsha"] });
  await publish(f, { commit: "C", branch: "chore/changelog-sync-v1.9.0", mode: "create" });
  assert.deepEqual(f.calls[2].body.parents, ["devsha", "mainsha"]);
  assert.equal(f.calls[1].body.base_tree, "BASE");
});

test("create mode creates the ref", async () => {
  const f = fakes();
  await publish(f, { commit: "C", branch: "chore/changelog-sync-v1.9.0", mode: "create" });
  assert.deepEqual(f.calls[3], {
    method: "POST", path: "git/refs", body: { ref: "refs/heads/chore/changelog-sync-v1.9.0", sha: "SIGNED" },
  });
});

test("force mode replaces the ref", async () => {
  const f = fakes();
  await publish(f, { commit: "C", branch: "chore/changelog-sync-v1.9.0", mode: "force" });
  assert.deepEqual(f.calls[3], {
    method: "PATCH", path: "git/refs/heads/chore/changelog-sync-v1.9.0", body: { sha: "SIGNED", force: true },
  });
});

test("a tree that differs from the local one stops before any commit is made", async () => {
  const f = fakes({ apiTree: "OTHER" });
  await assert.rejects(publish(f, { commit: "C", branch: "main", mode: "update" }), /tree OTHER but the local tree is T/);
  assert.equal(f.calls.some((c) => c.path === "git/commits"), false);
});

test("an unsigned commit is never published", async () => {
  const f = fakes({ verified: false });
  await assert.rejects(publish(f, { commit: "C", branch: "main", mode: "update" }), /not verified \(unsigned\)/);
  assert.equal(f.calls.some((c) => c.path.startsWith("git/refs")), false);
});

test("an unknown mode is rejected before any API call", async () => {
  const f = fakes();
  await assert.rejects(publish(f, { commit: "C", branch: "main", mode: "push" }), /mode/);
  assert.equal(f.calls.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .github/scripts/signed-commit.test.mjs`
Expected: FAIL, `Cannot find module ... signed-commit.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// .github/scripts/signed-commit.mjs
// Publishes a commit the release job built locally, through the REST git-data
// API instead of `git push`, so GitHub signs it: commits created through the API
// with GITHUB_TOKEN and no author/committer are signed by GitHub and show as
// Verified, which the required_signatures ruleset needs (#373).
//
// The local commit stays the source of truth. Its tree is rebuilt from the diff
// against its first parent, and the result must have the same tree SHA as the
// local commit before anything is created, so a byte that changed on the way
// (line endings, a dropped deletion, a mode) fails the step instead of
// publishing a different commit. Parents are copied as-is, so the sync PR's
// merge commit keeps both of them (#168).
//
// Standalone on purpose: the sync step runs it from $RUNNER_TEMP after checking
// out a branch cut from dev, which need not contain this file.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MODES = new Set(["update", "create", "force"]);

// `git diff --raw -z`: ":<oldmode> <newmode> <oldsha> <newsha> <status>\0<path>\0"
export function parseRawDiff(out) {
  const parts = out.split("\0");
  const entries = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i];
    if (!meta.startsWith(":")) continue;
    const [oldMode, newMode, , newSha, status] = meta.slice(1).split(" ");
    const path = parts[i + 1];
    entries.push(status === "D" ? { path, mode: oldMode, sha: null } : { path, mode: newMode, sha: newSha });
  }
  return entries;
}

export function refPath(branch) {
  return `git/refs/heads/${branch}`;
}

export async function publish({ git, gitBuffer, api }, { commit, branch, mode }) {
  if (!MODES.has(mode)) throw new Error(`mode must be update, create or force, not ${mode}`);
  const parents = git(["rev-list", "--parents", "-n", "1", commit]).trim().split(" ").slice(1);
  const message = git(["log", "-1", "--format=%B", commit]).trimEnd();
  const localTree = git(["rev-parse", `${commit}^{tree}`]).trim();
  const baseTree = git(["rev-parse", `${parents[0]}^{tree}`]).trim();
  const changed = parseRawDiff(git(["diff", "--raw", "-z", "--no-renames", "--no-abbrev", parents[0], commit]));

  const tree = [];
  for (const { path, mode: fileMode, sha } of changed) {
    if (sha === null) {
      tree.push({ path, mode: fileMode, type: "blob", sha: null });
      continue;
    }
    const content = gitBuffer(["cat-file", "blob", sha]).toString("base64");
    const blob = await api("POST", "git/blobs", { content, encoding: "base64" });
    tree.push({ path, mode: fileMode, type: "blob", sha: blob.sha });
  }
  const built = await api("POST", "git/trees", { base_tree: baseTree, tree });
  if (built.sha !== localTree) {
    throw new Error(`API built tree ${built.sha} but the local tree is ${localTree}; refusing to publish a different commit`);
  }

  const created = await api("POST", "git/commits", { message, tree: built.sha, parents });
  if (!created.verification?.verified) {
    throw new Error(`commit ${created.sha} is not verified (${created.verification?.reason}); refusing to move ${branch}`);
  }

  if (mode === "create") {
    await api("POST", "git/refs", { ref: `refs/heads/${branch}`, sha: created.sha });
  } else {
    await api("PATCH", refPath(branch), { sha: created.sha, force: mode === "force" });
  }
  return created.sha;
}

function githubApi() {
  const base = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN must be set");
  return async (method, path, body) => {
    const res = await fetch(`${base}/repos/${repo}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text}`);
    return JSON.parse(text);
  };
}

async function main([commit, branch, mode]) {
  if (!commit || !branch || !mode) {
    console.error("usage: signed-commit.mjs <commit> <branch> <update|create|force>");
    process.exit(2);
  }
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  const gitBuffer = (args) => execFileSync("git", args);
  const sha = await publish({ git, gitBuffer, api: githubApi() }, { commit, branch, mode });
  console.log(sha);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .github/scripts/signed-commit.test.mjs`
Expected: all 12 tests PASS. Then `node --test ".github/scripts/*.test.mjs"`: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add .github/scripts/signed-commit.mjs .github/scripts/signed-commit.test.mjs
git commit -m "feat(ci): add a script that publishes a local commit through the API so GitHub signs it (#373)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

### Task 2: Dry runs against scratch branches

Two parts. **2a** runs locally and tests the mechanics: the tree rebuild and both parent shapes. It cannot test signing, because GitHub is not documented to sign git-data commits made with a personal token; there the script's own check will most likely stop with `not verified`, which is fine for 2a. **2b** runs inside Actions with `GITHUB_TOKEN`, the identity the release job uses, and is what proves the commits come out verified. **Do not start Task 3 until 2b passes.** Without it the first real release is the first test, and a failure there leaves `main` unreleased until the change is reverted.

The issue mentioned GraphQL `createCommitOnBranch` for the `main` commit. This plan uses the REST git-data API for both commits, because `createCommitOnBranch` cannot create the two-parent sync commit and one code path is simpler than two.

#### 2a: local mechanics

- [ ] **Step 1: Single-parent commit (the `main` changelog case)**

```bash
cd /e/Personal/looper
git fetch -q origin
git checkout -q -b scratch/signed-commit-a origin/dev
printf '\n<!-- dry run ü -->\r\n' >> CHANGELOG.md
git commit -qam "chore: signed-commit dry run (single parent)"
GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=DataCrusade1999/supreme-enigma \
  node .github/scripts/signed-commit.mjs HEAD scratch/signed-commit-a create
```

Expected: either a SHA on stdout, or `::error::commit <sha> is not verified (...)`. Either way the tree check has already passed. Confirm the commit object GitHub built:
`gh api repos/DataCrusade1999/supreme-enigma/git/commits/<sha> --jq '"\(.tree.sha) \(.parents|length)"'` prints the output of `git rev-parse HEAD^{tree}` and `1`.
If the error is `API built tree ... but the local tree is ...`, the rebuild is wrong: fix Task 1.

- [ ] **Step 2: Two-parent commit (the sync case)**

`dev` already contains `main`, so `git merge origin/main` would be a no-op. Build the two-parent commit directly; both parents exist on the server.

```bash
git checkout -q -b scratch/signed-commit-b origin/dev
printf '\n<!-- dry run merge -->\n' >> CHANGELOG.md
git add CHANGELOG.md
C=$(git commit-tree "$(git write-tree)" -p origin/dev -p origin/main -m "chore: signed-commit dry run (merge)")
GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=DataCrusade1999/supreme-enigma \
  node .github/scripts/signed-commit.mjs "$C" scratch/signed-commit-b create
```

Expected: as Step 1, and the `git/commits/<sha>` check prints `git rev-parse "$C^{tree}"` and `2`.

- [ ] **Step 3: Clean up**

```bash
git checkout -q dev
git branch -D scratch/signed-commit-a scratch/signed-commit-b
# Only if a step printed a SHA, i.e. the ref was created:
gh api -X DELETE repos/DataCrusade1999/supreme-enigma/git/refs/heads/scratch/signed-commit-a
gh api -X DELETE repos/DataCrusade1999/supreme-enigma/git/refs/heads/scratch/signed-commit-b
```

#### 2b: signing inside Actions

A throwaway workflow on a scratch branch, triggered by pushing that branch. It never reaches `dev`. Pushing a workflow file over HTTPS needs a token with the `workflow` scope (`gh auth refresh -s workflow`).

- [ ] **Step 4: Create the scratch branch with the dry-run workflow**

From the Task 1 branch (so the script is present):

```bash
git checkout -q -b scratch/signed-commit-ci
```

Create `.github/workflows/signed-commit-dryrun.yml`:

```yaml
name: signed-commit dry run
on:
  push:
    branches: [scratch/signed-commit-ci]
permissions:
  contents: write
jobs:
  dry-run:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - name: Publish through the API and check the signature
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          R="$GITHUB_REPOSITORY"
          check() {
            gh api "repos/$R/commits/$1" --jq '"verified=\(.commit.verification.verified) reason=\(.commit.verification.reason) author=\(.commit.author.name) parents=\(.parents|length) tree=\(.commit.tree.sha)"'
          }

          # update mode, one parent: the main changelog commit
          gh api -X POST "repos/$R/git/refs" -f ref=refs/heads/scratch/sc-a -f sha="$(git rev-parse origin/dev)" >/dev/null
          git checkout -q -b sc-a origin/dev
          printf '\n<!-- dry run ü -->\r\n' >> CHANGELOG.md
          git commit -qam "chore: signed-commit dry run (single parent)"
          node .github/scripts/signed-commit.mjs HEAD scratch/sc-a update
          check scratch/sc-a
          echo "local tree=$(git rev-parse HEAD^{tree})"

          # create then force, two parents: the sync commit and its re-run path
          git checkout -q -b sc-b origin/dev
          printf '\n<!-- dry run merge -->\n' >> CHANGELOG.md
          git add CHANGELOG.md
          C=$(git commit-tree "$(git write-tree)" -p origin/dev -p origin/main -m "chore: signed-commit dry run (merge)")
          node .github/scripts/signed-commit.mjs "$C" scratch/sc-b create
          check scratch/sc-b
          node .github/scripts/signed-commit.mjs "$C" scratch/sc-b force
          check scratch/sc-b
          echo "local tree=$(git rev-parse "$C^{tree}")"
      - name: Delete the scratch refs
        if: always()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          for r in sc-a sc-b; do
            gh api -X DELETE "repos/$GITHUB_REPOSITORY/git/refs/heads/scratch/$r" || true
          done
```

```bash
git add .github/workflows/signed-commit-dryrun.yml
git commit -m "chore: signed-commit dry run (scratch only, do not merge)"
git push -u origin scratch/signed-commit-ci
```

- [ ] **Step 5: Read the result**

```bash
gh run list --branch scratch/signed-commit-ci --limit 1
gh run watch <id> --exit-status
gh run view <id> --log | grep -E "verified=|local tree="
```

Expected: the job passes, and every `check` line reads `verified=true reason=valid author=github-actions[bot]`, with `parents=1` for `sc-a` and `parents=2` for both `sc-b` lines, and `tree=` equal to the `local tree=` printed after it. Note the `author=` value: Task 4 Step 3 depends on it.

If `verified=false`: stop. GitHub does not sign REST git-data commits for `GITHUB_TOKEN`, and the plan's approach does not work. Report back before changing anything.

- [ ] **Step 6: Delete the scratch branch**

```bash
git checkout -q dev
git branch -D scratch/signed-commit-ci
git push origin --delete scratch/signed-commit-ci
```

### Task 3: Wire the script into the release job, and document it

**Files:**
- Modify: `.github/workflows/deploy.yml` (`release` job: "Commit CHANGELOG.md to main", "Open changelog-sync PR to dev")
- Modify: `.claude/rules/ci.md`
- Modify: `.claude/skills/merging-a-pr/SKILL.md` (section "The changelog-sync PR")

**Interfaces:**
- Consumes: `node signed-commit.mjs <commit> <branch> <update|create|force>` from Task 1; prints the new SHA.

- [ ] **Step 1: Changelog commit on `main`**

Replace the step body:

```yaml
      - name: Commit CHANGELOG.md to main
        id: changelog_commit
        if: steps.changelog.outputs.changed == 'true'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add CHANGELOG.md
          git commit -m "chore(changelog): release ${{ steps.version.outputs.tag }}"
          # Published through the API, not pushed, so GitHub signs it and the
          # required_signatures rule on main accepts it (#373). Fast-forward
          # only: if main moved since checkout, this fails and a re-run starts
          # from the new main.
          SHA=$(node .github/scripts/signed-commit.mjs HEAD main update)
          git fetch --quiet origin main
          echo "sha=$SHA" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 2: Sync branch**

In "Open changelog-sync PR to dev": add `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to `env:`; next to the existing `cp .github/scripts/changelog-sync.py "$RUNNER_TEMP/changelog-sync.py"` add

```bash
          cp .github/scripts/signed-commit.mjs "$RUNNER_TEMP/signed-commit.mjs"
```

and replace the two pushes:

```bash
              git push --force origin "$BRANCH"
```
becomes
```bash
              node "$RUNNER_TEMP/signed-commit.mjs" HEAD "$BRANCH" force
```
and
```bash
            git push origin "$BRANCH"
```
becomes
```bash
            node "$RUNNER_TEMP/signed-commit.mjs" HEAD "$BRANCH" create
```

Add one line to the comment above the `if git ls-remote` block: `Published through the API so GitHub signs it (#373); the local commit is only the blueprint.`

- [ ] **Step 3: Check the result**

Run: `python -c "import yaml;yaml.safe_load(open('.github/workflows/deploy.yml'))"` → no error.
Run: `grep -n "git push" .github/workflows/deploy.yml` → no match inside the `release` job.
Run: `node --test ".github/scripts/*.test.mjs"` → 0 failures.

- [ ] **Step 4: Docs**

In `.claude/rules/ci.md`, after the bullet about `release` auto-tagging, add:

```markdown
- **The `release` job never `git push`es.** Both of its commits (the changelog commit on `main`, the sync merge commit on `chore/changelog-sync-*`) are built locally and published by `.github/scripts/signed-commit.mjs` through the REST git-data API, so GitHub signs them and the `required_signatures` rule accepts them (#373). The script refuses to publish if the API-built tree differs from the local one or if GitHub did not mark the commit verified. `main` is updated fast-forward only.
```

In `.claude/skills/merging-a-pr/SKILL.md`, at the end of the first paragraph of "The changelog-sync PR", add:

```markdown
Both of the job's commits are created through the API (`signed-commit.mjs`) so they are signed; a sync PR showing an unsigned commit means the job ran an old `deploy.yml` or the script was bypassed, and the `required_signatures` rule on `dev` will refuse it.
```

- [ ] **Step 5: Commit, PR, merge**

```bash
git add .github/workflows/deploy.yml .claude/rules/ci.md .claude/skills/merging-a-pr/SKILL.md
git commit -m "feat(ci): publish release-job commits through the API so they are signed (#373)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```
Open the PR into `dev` with `Closes #373`, add a `CHANGELOG.md` entry under `[Unreleased]` → `### Changed` ("Release commits are now signed by GitHub."), and merge through the `merging-a-pr` skill.

### Task 4: Turn on `required_signatures` and verify on the first real release

**Files:** none (repo settings), then `CLAUDE.md` once both rules are on.

- [ ] **Step 1: `dev`, right after Task 3 merges**

First confirm the other writers to `dev` already produce signed commits:

```bash
R=DataCrusade1999/supreme-enigma
# Keystatic (blog content): which branch it commits to, and whether its commits verify
gh api "repos/$R/commits?sha=dev&path=content&per_page=5" --jq '.[]|"\(.commit.verification.verified) \(.commit.author.name) \(.commit.message|split("\n")[0])"'
# Dependabot
gh api "repos/$R/commits?sha=dev&author=dependabot%5Bbot%5D&per_page=3" --jq '.[]|"\(.commit.verification.verified) \(.commit.message|split("\n")[0])"'
```

Expected: every line starts with `true`. If a Keystatic commit is `false`, or Keystatic commits straight to `dev` without a PR, stop: the rule would break publishing. Report it before going on.

Between this step and the next promotion reaching `main`, do not run `workflow_dispatch` on `main`. `main` still runs the old `deploy.yml` until then, so its sync PR would carry an unsigned merge commit that `dev` now refuses.

Then create the ruleset:

Add a separate ruleset so `permanent-branches` keeps its meaning:

```bash
gh api -X POST repos/DataCrusade1999/supreme-enigma/rulesets --input - <<'EOF'
{
  "name": "signed-commits",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/dev"], "exclude": [] } },
  "rules": [ { "type": "required_signatures" } ],
  "bypass_actors": [ { "actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always" } ]
}
EOF
```

- [ ] **Step 2: `stage` and `main`, after the next promotion**

`5bd16bb` and `3702f9c` (unsigned, from the v1.8.0 release) are on `dev` but not yet on `stage`, and `3702f9c` is not on `main`. Promote `dev → stage → main` first, then add both branches to the ruleset's `include` with a `PUT` to `repos/DataCrusade1999/supreme-enigma/rulesets/<id>` (read the id from `gh api repos/DataCrusade1999/supreme-enigma/rulesets`). Do not turn it on earlier and merge the promotion with `--admin` instead: that works, but it makes the bypass routine.

- [ ] **Step 3: Verify the first release after Task 3**

After the next push to `main` releases:
```bash
gh api "repos/DataCrusade1999/supreme-enigma/commits?sha=main&per_page=1" --jq '.[0]|"\(.commit.verification.verified) \(.commit.author.name)"'
gh api "repos/DataCrusade1999/supreme-enigma/commits?sha=chore/changelog-sync-vX.Y.Z&per_page=1" --jq '.[0]|"\(.commit.verification.verified) \(.commit.author.name) \(.parents|length)"'
```
Expected: `true github-actions[bot]` and `true github-actions[bot] 2`. If the author name is not `github-actions[bot]`, update the leftover-branch guard in the sync step (`git log -1 --format=%an`) to match before the next release.

- [ ] **Step 4: Document the ruleset**

Add `signed-commits` to the rulesets list in `CLAUDE.md` (Branching & releases), through an issue and PR like any other change.

# Runbook — release promotion (`dev` → `stage` → `main`)

## When to use this

Work has landed on `dev` and you want it on `stage` for QA, or on `main` for
production. Also use it to check what is currently deployed where.

Not for merging a feature branch into `dev` — that is the review sequence in
`CLAUDE.md` ("Merging a PR"), which this runbook assumes you already followed.

## Prerequisites

- Shared prerequisites in [README.md](README.md#shared-prerequisites).
- Local `dev` up to date: `git checkout dev && git pull --ff-only origin dev`.
- The work you are promoting has a `## [Unreleased]` entry in `CHANGELOG.md`.
  Nothing adds this for you; the release job only renames the heading.

## Environments

| Branch | URL | Lambda | Bucket |
|---|---|---|---|
| `main` | https://bgm-looper.vercel.app | `bgm-looper-processor` | `portfolio-data-223376380711` |
| `stage` | https://bgm-looper-git-stage-ashutosh-pandeys-projects-77cb3a00.vercel.app | `bgm-looper-processor-stage` | `portfolio-data-stage-223376380711` |
| `dev` | https://bgm-looper-git-dev-ashutosh-pandeys-projects-77cb3a00.vercel.app | `bgm-looper-processor-dev` | `portfolio-data-dev-223376380711` |

## Procedure

### 1. Open the promotion PR

```bash
gh pr create --base stage --head dev \
  --title "chore: promote dev to stage" --body "..."
```

Do **not** write `Closes #N` on a promotion PR. GitHub only honours the
keyword on the default branch, which is `dev` — the issues were already
closed when the work merged there.

### 2. Wait for both reviewers

```bash
gh pr checks <N> --watch --interval 20
gh api repos/DataCrusade1999/supreme-enigma/commits/<sha>/status \
  --jq '.statuses[] | {context, state, description}'
```

`changes`/`deploy`/`release` showing `SKIPPED` is normal — those are
push-triggered. The release-readiness verdict is a **commit status, not a
check-run**, so it will not appear in `gh pr checks`. Anything other than
`Release readiness review: change approved` is a hard stop.

Then read the inline comments from both bots — `gh pr view` does not show
them:

```bash
gh api --paginate repos/DataCrusade1999/supreme-enigma/pulls/<N>/comments \
  --jq '.[] | {user: .user.login, path, line, body: .body[0:200]}'
```

`--paginate` is not optional; the REST default of 30 per page silently hides
the rest. Triage and thread-resolution rules are in `CLAUDE.md`.

### 3. Fix findings on `dev`, never on the promotion PR

Committing to a promotion PR pushes to `stage` or `main` and diverges it from
`dev`. Open a normal PR into `dev` instead; the promotion picks the commit up
and re-runs.

### 4. Merge

```bash
gh pr merge <N> --merge          # NEVER --squash, NEVER --delete-branch
```

Both wrong options are destructive here. `--delete-branch` deletes a
permanent branch. `--squash` collapses the promoted commits into a new commit
that exists on neither side's history, so the branches permanently diverge and
every later promotion conflicts.

Check the shape afterwards — a promotion is a merge commit with two parents:

```bash
git log origin/stage --format='%h %p %s' -3
```

If the second parent column is empty, it was squashed. Stop and reconcile
before promoting again.

### 5. Verify the deployment

Vercel deploys from the branch automatically, but only if the commit touches
`web/` or `content/` — the `ignore_command` on `vercel_project.looper` is an
allowlist, so a promotion carrying only `lambda/` or `infra/` changes produces
no new frontend deployment. That is correct behaviour, not a failed deploy.

Backend, per environment:

```bash
aws lambda get-function --function-name bgm-looper-processor \
  --query 'Code.ImageUri' --output text --profile personal --region us-east-1
```

Confirm the tag's sha is on the branch and that no `lambda/` change is
missing from it — the procedure is in
[stale-lambda-recovery.md](stale-lambda-recovery.md#detect).

On `main` only, a release is cut, in this order: a `chore(changelog): release
vX.Y.Z` commit on `main`, a `chore/changelog-sync-vX.Y.Z` PR back into `dev`,
and then the tag and GitHub Release. The tag is last on purpose — the sync step
is fatal on failure, so a failure leaves nothing published and re-running the
job is the recovery path.

**Merge that sync PR, with `--merge` and never `--squash`.** Until it lands,
`dev`'s history does not contain the release commit, and `promotion-guard`
fails every PR into `stage` and `main` — correctly, because merging one would
duplicate the version heading in `CHANGELOG.md` (#168). Squashing it breaks the
same way, which is what happened to v1.5.1.

It gets CI, but the run does not start on its own. Because the bot opens the
PR, GitHub finishes the `pull_request` run as `completed/action_required`
without running a job, so only Vercel reports and `gh pr checks` looks green
while the test jobs and the readiness review are absent. Approve the run, then review
it like any other PR:

```bash
RUN=$(gh run list --branch "chore/changelog-sync-vX.Y.Z" --limit 1 --json databaseId --jq '.[0].databaseId')
gh api -X POST "repos/DataCrusade1999/supreme-enigma/actions/runs/$RUN/approve"
```

Absent test jobs here mean gated, not skipped. Never merge on a green Vercel
check alone (#207).

Entries that landed on `dev` after the promotion are handled by the sync step
itself: they stay under `## [Unreleased]` and nothing needs moving by hand. If
the PR *title* says `main has N entries dev does not`, that one needs a look —
it means a direct commit to `main` or an entry reworded on `dev`.

```bash
gh release list --limit 3
gh pr list --base dev --state open --search "changelog sync in:title"   --json number,title,headRefName
```

`--head` is an exact match and does not take globs, hence the search. Every
sync PR so far has merged (#23, #72, #117, #125, #144); an open one is the
thing to act on.

## Rollback

There is no one-command rollback. In order of preference:

1. **Frontend only** — redeploy the previous good deployment from the Vercel
   dashboard (Deployments → the previous build → Promote/Redeploy). Verify
   the option is present for this project's plan before relying on it in an
   incident; it has not been exercised here.
2. **Revert forward** — `git revert` on `dev`, PR it, then promote through
   `stage` to `main` as above. Slower, but it is the only path that keeps all
   three branches consistent.
3. **Lambda** — ECR keeps only the last image per branch prefix, so there is
   no previous image to point at. Recovery is a rebuild from git history:
   revert on `dev`, promote, and let CI build a new image.

Never reset or force-push `stage` or `main` to roll back. Branch protection
is not enforced on this repo (GitHub blocks it on private repos without Pro),
so nothing will stop you, and it desynchronises every branch.

## Escalation

See [README.md](README.md#escalation). For a promotion that passed review but
broke production, the AWS DevOps Agent's `investigate` flow is the right next
call.

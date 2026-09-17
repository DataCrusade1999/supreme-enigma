# Runbook — stale Lambda recovery

## When to use this

The DSP pipeline is suspected to be running an older image than the branch's
code. The usual trigger: a `deploy` job failed (this has happened for real,
from a transient `johnvansickle.com` network timeout during the ffmpeg
download), nobody reran it, and later pushes that do not touch `lambda/`
legitimately skip `deploy` — so the function stays on the last image that
built, indefinitely and silently.

Also use it after any `deploy` job failure, before assuming the next push
will fix it. It will not.

## Prerequisites

- Shared prerequisites in [README.md](README.md#shared-prerequisites).
- `gh` with permission to rerun workflow runs.

## Detect

**A newer branch head than the deployed image tag is not by itself a fault.**
`deploy` only runs when a push's diff touches `lambda/` or `deploy.yml`, so
the deployed sha legitimately trails the branch head most of the time. What
matters is whether any *pipeline* change is missing from it.

```bash
FN=bgm-looper-processor        # -dev / -stage for the other environments
BRANCH=main                    # dev / stage

IMG=$(aws lambda get-function --function-name "$FN" \
  --query 'Code.ImageUri' --output text --profile personal --region us-east-1)
echo "$IMG"
DEPLOYED_SHA=${IMG##*:}; DEPLOYED_SHA=${DEPLOYED_SHA#*-}

git fetch origin --quiet
git merge-base --is-ancestor "$DEPLOYED_SHA" "origin/$BRANCH" \
  && echo "on-branch: yes" || echo "on-branch: NO — wrong branch's image"
git diff --stat "$DEPLOYED_SHA" "origin/$BRANCH" -- lambda/
```

Healthy output, run verbatim against `main` on 2026-09-15:

```
223376380711.dkr.ecr.us-east-1.amazonaws.com/bgm-looper-lambda:main-72fe99d1a833cc3c53f144788dbc48a8ec9db25f
on-branch: yes
```

— followed by no `git diff --stat` output at all, which is the point.

Read it as:

| Signal | Meaning |
|---|---|
| `on-branch: yes`, empty `lambda/` diff | Healthy. Trailing sha is by design. |
| `on-branch: yes`, non-empty `lambda/` diff | **Stale.** Pipeline code on the branch is not deployed. |
| `on-branch: NO` | The function is running another branch's or an orphaned image. Treat as stale. |

Do not substitute `git log -1 -- lambda/` for the diff. History simplification
skips merge commits, so it returns a commit that is not the one CI tagged, and
reports a false mismatch.

Cross-check what ECR actually holds:

```bash
aws ecr describe-images --repository-name bgm-looper-lambda \
  --query 'sort_by(imageDetails,&imagePushedAt)[].{tag:imageTags[0],pushed:imagePushedAt}' \
  --output table --profile personal --region us-east-1
```

One tag per branch prefix is expected — the lifecycle policy keeps the last 1
each. A missing `stage-*` or `dev-*` tag means that branch has never had a
successful `deploy`.

Find the failed run, if there is one:

```bash
gh run list --workflow deploy.yml --branch "$BRANCH" --limit 10 \
  --json databaseId,conclusion,headSha,createdAt,displayTitle
```

## Fix

### Preferred — rerun the failed jobs on the most recent failed run

```bash
gh run rerun <databaseId> --failed
```

This rebuilds at the commit that *should* have deployed, so the resulting
image tag matches what the rest of the history expects, and on `main` the
`release` job runs for the right commit.

The build/push step is idempotent: it calls `aws ecr describe-images` for the
exact tag first and skips build+push if it already exists. That check is what
makes a rerun safe — the repo is `IMMUTABLE`, so re-pushing the same tag would
hard-fail with `ImageTagAlreadyExistsException`.

If the rerun fails for the same transient reason, rerun again before
escalating; that was the resolution the one time this occurred.

One caveat on `main`: if the branch has moved since that run, the rerun's
`release` half can fail on a non-fast-forward changelog push or a tag that
already exists. That is cosmetic here — `deploy` is the job you wanted and it
still lands. Confirm with the detect block rather than by the run's overall
red/green.

### Fallback — `workflow_dispatch`

```bash
gh workflow run deploy.yml --ref "$BRANCH"
```

`workflow_dispatch` bypasses the `changes` gate entirely and always rebuilds.
On `dev` and `stage` this is clean — `release` is `main`-only.

> **On `main`, a dispatch also cuts a release.** `release`'s condition treats
> `workflow_dispatch` as satisfying its changes-gate, and `Determine next
> version` defaults `BUMP=patch` when it finds no qualifying commits since the
> last tag. So a dispatch on `main` renames `[Unreleased]` in `CHANGELOG.md`,
> pushes that to `main`, opens a `chore/changelog-sync-*` PR, and then tags a
> new patch version and creates a GitHub Release — for a run that shipped no
> new code. This is read from the workflow's `if:` conditions, not observed;
> it has not been triggered deliberately. Prefer the rerun path on `main`, and
> if you do dispatch, expect the release and merge the sync PR so the branches
> stay consistent.

### Verify

Re-run the detect block. The `lambda/` diff against the deployed sha must be
empty, and the image tag must have changed.

Then exercise the pipeline end to end through `/tools/bgm-looper` on that
environment, and read the invocation:

```bash
MSYS_NO_PATHCONV=1 aws logs tail "/aws/lambda/$FN" --since 10m \
  --profile personal --region us-east-1
```

`MSYS_NO_PATHCONV=1` is required in Git Bash — see
[README.md](README.md#shared-prerequisites).

## Rollback

None available. ECR's lifecycle policy keeps only the last image per branch
prefix, so the previous image is already gone by the time a bad one is
deployed. If a newly deployed image is worse than the one it replaced, the
recovery path is to revert the `lambda/` change on `dev` and promote it
forward, which builds a fresh image. Budget for the full promotion cycle.

## Escalation

See [README.md](README.md#escalation). If the image is current and invocations
still fail, this is not a staleness problem — go to
[incident-tool-down.md](incident-tool-down.md).

# CI: split jobs, cross-OS e2e, free security scan, run summary — design

**Date:** 2026-09-18
**Status:** approved in chat, not yet implemented
**Issue:** #212
**Plan:** `docs/superpowers/plans/2026-09-18-ci-matrix-security-summary.md`

## 1. What changes

`.github/workflows/deploy.yml` today has one `test` job that runs Lambda
pytest, ESLint, Vitest and Playwright in sequence on `ubuntu-latest`, then
`deploy` and `release` gate on `needs.test.result`. This design:

1. Splits `test` into four independent jobs (`unit`, `lambda`, `e2e`,
   `security`) plus a `summary` rollup that writes one status table.
2. Runs Playwright on Windows and macOS as well as Linux, but only where the
   minute budget allows (§3).
3. Adds a security scan that costs nothing on a private free-plan repo (§4).
4. Keeps unit tests Linux-only (§5).
5. Adds a `concurrency` group that cancels superseded PR runs and never
   cancels a push run (§6).

`promotion-guard`, `changes`, `deploy` and `release` keep their logic. Only
their `needs:` lists and the `needs.test.result` clauses in the custom `if:`
chains change, because `test` no longer exists.

## 2. Constraints that shaped it

- **Private repo, personal account, GitHub Free.** 2,000 Actions minutes per
  month. Per-minute rates on GitHub's Actions billing page (read 2026-09-18):
  Linux 2-core $0.006, Windows 2-core $0.010, macOS $0.062, so Windows costs
  about 2x and macOS about 10x Linux against the quota. Default spending limit
  is $0: when the quota is gone, runs stop queuing until the month resets, and
  `release` on `main` stops with them. No card is ever charged unless the
  limit is raised by hand.
- **Measured baseline** (run 35267707447, 2026-09-17): `test` took 4m03s on
  Linux, of which the e2e slice (Node setup → `npm install` → Playwright
  install → build + run) was about 3 minutes.
- **`push` and `pull_request` both trigger the workflow**, so one PR commit
  plus its merge is two runs. Five runs landed in one hour on 2026-09-17.
- **Advanced Security is not available on private repos without paying.**
  CodeQL, `dependency-review-action` and SARIF upload to the Security tab are
  all out. Dependabot alerts are free and already on.
- **The Lambda deploy target is Linux only** (`public.ecr.aws/lambda/python`),
  and its tests need `apt-get install ffmpeg`.
- **All `run:` steps are written in bash** (`set -o pipefail`, `$GITHUB_OUTPUT`,
  `|| EXIT_CODE=$?`). `windows-latest` defaults to PowerShell.

## 3. E2E matrix and when it runs cross-OS

| Event | OS legs |
|---|---|
| `pull_request` into `dev` | `ubuntu-latest` |
| `push` to `dev` / `stage` / `main` | `ubuntu-latest` |
| `pull_request` into `stage` or `main` (promotion) | `ubuntu-latest`, `windows-latest`, `macos-latest` |
| `workflow_dispatch` | `ubuntu-latest`, `windows-latest`, `macos-latest` |

The matrix is an expression, no extra job:

```yaml
matrix:
  os: ${{ fromJSON((github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && (github.base_ref == 'stage' || github.base_ref == 'main'))) && '["ubuntu-latest", "windows-latest", "macos-latest"]' || '["ubuntu-latest"]') }}
```

The ternary chooses between two JSON *strings* inside `fromJSON`, because
string truthiness is defined in GitHub's expression language and array
truthiness is not documented.

Estimated quota cost per run, from the measured baseline:

| Run shape | Quota minutes |
|---|---|
| Ordinary (Linux only, 5 jobs) | ~6 |
| Promotion PR (adds Windows 7m03s x2, macOS 1m15s x10) | ~42 |

At 150 ordinary runs and 6 promotions a month that is about 1,300 minutes,
inside the 2,000 quota. Cross-OS on every PR would be about 42 per run and
exhaust the quota within days. The first dispatched run after the change
measured real Windows/macOS wall-clock, on run `35361326872`.

A promotion PR's head is `dev`, so every push to `dev` while one is open
re-triggers a cross-OS run. `cancel-in-progress` (§6) stops the superseded
run, but each one bills until it is cancelled. Open promotions when `dev` is
quiet.

`fail-fast: false` so a Windows failure does not cancel the Linux leg's
report. `defaults.run.shell: bash` on the job. `test-summary.mjs` gains a
`--label` argument so the three legs' summary sections are distinguishable.

The `release-tests.yml` workflow (AWS DevOps Agent UI testing) is unrelated
and untouched.

## 4. Security scan

One job, one action, no account, no licence key:

- **Trivy** (`aquasecurity/trivy-action`), filesystem mode over the repo root
  with `scanners: vuln,misconfig,secret`. That covers `web/package-lock.json`
  vulnerabilities, `lambda/Dockerfile` and `infra/**/*.tf` misconfiguration,
  and hard-coded secrets in the working tree, in one pass.
- `severity: HIGH,CRITICAL`, `ignore-unfixed: true`. Only findings with an
  available fix can fail the job, so a CVE with no patched release does not
  block an unrelated release.
- Output is `table` format written to a file and rendered into the job
  summary by `.github/scripts/security-summary.mjs`. No SARIF, because the
  Security tab is paywalled here.
- **Ships report-only first** (`exit-code: "0"`), gets one `workflow_dispatch`
  run to surface the existing findings, those are triaged into fixes or a
  committed `.trivyignore` with a one-line reason per entry, then the job
  flips to `exit-code: "1"` in the same PR. The alternative, gating from the
  first commit, would red-X the PR on pre-existing Terraform misconfigs and
  teach everyone to ignore it.
- `security` gates `deploy` and `release` the same way `unit`, `lambda` and
  `e2e` do. `.trivyignore` is the escape hatch; a blocked release is fixed by
  a PR that either bumps the dependency or adds the ignore with its reason.
- Trade-off accepted: a scanner infrastructure failure (Trivy's vulnerability
  DB download is rate-limited now and then) also blocks `deploy` and `release`
  until someone reruns the job. The summary script distinguishes that case
  ("the scanner did not complete") from real findings by reading Trivy's
  `Total:` lines rather than the step outcome, so the rerun decision is
  obvious from the summary. `gh run rerun <id> --failed` is the fix.
  Trivy prints `Total: N` for vulnerability and secret targets but
  `Failures: N` for misconfiguration targets, and nothing at all for a clean
  target on current versions (only the "Report Summary" box), so the script
  counts both forms and treats "no count line + outcome success" as clean.

Known gaps, accepted: `lambda/requirements.txt` holds version ranges, which
Trivy's pip parser skips (it needs pinned `==`), so Python dependency
vulnerabilities come only from Dependabot. Trivy's secret scanner reads the
working tree, not git history. gitleaks would add history scanning but is a
second action under a proprietary EULA (free for personal accounts); not
worth it for the marginal coverage, revisit if a leak ever happens.

## 5. Unit tests stay Linux-only

Vitest runs under jsdom against pure logic in `web/lib`; nothing there touches
the filesystem or an OS API. The Lambda runs in a Linux container and its
tests need apt ffmpeg. A Windows or macOS unit leg would spend 2x-10x minutes
to test a platform neither artifact ships on. The developer works on Windows,
so "passes in CI, fails locally" is real, but `npm test` before pushing
already catches it at zero quota.

## 6. Concurrency

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

A new push to a PR cancels the run it supersedes. Push runs get a unique
group per SHA so nothing is ever cancelled or queued behind another push:
cancelling a push run could kill `deploy` mid `update-function-code` or
`release` between the changelog commit and the tag.

## 7. Run summary

A `summary` job with `needs: [unit, lambda, e2e, security]` and `if: always()`
runs `.github/scripts/run-summary.mjs`, which reads `${{ toJSON(needs) }}` and
appends one table to `$GITHUB_STEP_SUMMARY`:

```
## CI summary

| Job | Result |
|---|---|
| Lint + unit tests | ✅ success |
| Lambda tests | ✅ success |
| E2E (Playwright) | ❌ failure |
| Security scan | ✅ success |

Cross-OS e2e: no (pull_request into dev). Runs on promotion PRs and workflow_dispatch.
```

Emoji is limited to the status column (✅ ❌ ⏭️ for skipped, 🚫 for
cancelled). The per-suite sections written by `test-summary.mjs` and
`security-summary.mjs` stay text. `summary` is not in any `needs:` list; it
reports, it does not gate.

Step summaries are per job, so a single overview is only possible from a job
that depends on all the others. That is the only reason `summary` exists.

## 8. Gating after the split

```
deploy:  needs [unit, lambda, e2e, security, changes]
         if: always() && needs.unit.result == 'success' && needs.lambda.result == 'success'
             && needs.e2e.result == 'success' && needs.security.result == 'success'
             && (dispatch || (push && changes ok && lambda changed))
release: needs [unit, lambda, e2e, security, deploy, changes]
         if: same four == 'success' && deploy not failure/cancelled && (dispatch || (push && releasable))
```

Every clause stays fail-closed: a job that was skipped or cancelled reads as
not `success` and blocks. The existing comments explaining why the default
`if: success()` cannot be used are kept verbatim.

`deploy` also gains `contains(fromJSON('["main", "dev", "stage"]'),
github.ref_name)`. The cross-OS matrix is exercised by `workflow_dispatch`
from the feature branch before any promotion, and on such a branch `deploy`
cannot succeed: the `bgm-looper-ci-deploy` role's OIDC trust policy is
`StringEquals` on exactly those three refs, and the job's branch `case` has no
default arm. Without the clause the measurement run ends with a red `deploy`
that means nothing. This is a latent gap today, not one the split introduces.

If the Storybook + Chromatic plan (#209) lands first, its `chromatic` job is
added to `summary`'s `needs:` and table as a reported row only, never to
`deploy`/`release` gating, per that plan's own rule.

## 9. Documentation that has to move with it

- `CLAUDE.md`: the "App unit tests" bullet (`CI's test job runs Vitest and
  Playwright`), the `test-summary.mjs` bullet, and merge step 1 ("Wait for CI
  `test`") all name the old job.
- `docs/runbooks/infra-apply-teardown.md` line 27 and
  `docs/runbooks/release-promotion.md` lines 122 and 130 say `test`.
- `CHANGELOG.md` entry under `## [Unreleased]`.
- Merging this PR touches `deploy.yml`, so the `changes` job will rebuild the
  Lambda image on the push to `dev`. Expected, not a bug.

## 10. Out of scope

- Caching Trivy's DB across branches, HTML Playwright reports as artifacts,
  running `npm ci` instead of `npm install`, cross-OS Lambda tests, any change
  to `playwright.config.ts` unless the Windows/macOS build exceeds its 180 s
  `webServer` timeout on the measurement run.

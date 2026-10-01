# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions match the
git tags / GitHub Releases cut automatically by the `release` job in
`.github/workflows/deploy.yml` on every push to `main`.

## [Unreleased]

### Changed

- Vercel's AI-bots (deny) and bot-protection (challenge) managed rulesets, switched on in the dashboard on 2026-09-30, are now declared in Terraform, so the next `terraform apply` no longer turns them off. Bot protection answers non-browser clients without Vercel bot verification (curl, uptime checks) with a 429 challenge (#306).
- Dependabot groups each ecosystem's minor and patch bumps into one PR (Terraform: one per directory), and the `merging-a-pr` skill says to land any remaining Dependabot PRs as one batch PR, so the run on `dev` and the rebase runs are paid once (#312).
- CI bills fewer Actions minutes: about 7 per PR run instead of 10, 2 per `dev` push instead of 12, and about 44 per PR into `stage` down to 7. Lint, unit, Lambda, Trivy and Linux e2e run as one `test` job instead of four parallel ones; `test` is skipped on a push to `dev` that does not touch `lambda/`; docs-only PRs get no CI run; Windows and macOS e2e run only on PRs into `main`; `promotion-guard` moved to its own workflow; Dependabot runs monthly (#320).
- `chromatic` is skipped on a push to `dev` that does not touch `web/` or `deploy.yml` (#322).
- The skipped cross-OS e2e job is listed as `E2E` instead of the literal `E2E (${{ matrix.os }})`. On PRs into `main` its legs are still named `E2E (windows-latest)` and `E2E (macos-latest)`.

### Removed

- The Vercel firewall's `/api/login` rate-limit rule (#137). It stopped matching anything when #294 replaced that route with Cognito sign-in, and Vercel's API now refuses any Terraform update to the firewall that contains a rate-limit rule on the Hobby plan (#306).

## [1.6.0] - 2026-10-01

### Added

- "Add a passkey" link on the `/tools` hub. It signs you in, opens Cognito's passkey setup, and returns to the hub saying whether the passkey was added. Cognito never offers passkey setup to the owner account, which an admin created (#297).
- Favicon: the home page's loop ring reduced to 10 bars on a dark tile, with the twelve o'clock bar in red. It is served as `/icon.svg`, plus a 180×180 PNG apple-touch icon for Safari and iOS, which ignore SVG favicons (#281).
- The site is served at https://ashutosh-pandey.com, with `www.` redirecting to it, and the `dev` and `stage` branches at https://dev.ashutosh-pandey.com and https://stage.ashutosh-pandey.com. The `vercel.app` URLs still work (#275).
- Every environment except production sends `X-Robots-Tag: noindex`, so search engines do not list the `dev` and `stage` copies of the site (#275).
- News Desk Local and International tabs: headlines are split by where their feed is based (FT, Reuters, Bloomberg and The Economist are international; the rest are local), with the topic tabs counting within the selected region. Headlines saved before this change count as local until a Refresh sees them in a feed again.
- News Desk tool at `/tools/news-desk`: headlines on the Indian economy, reforms and legislation from 13 free RSS sources (FT, RBI, SEBI, Mint, Business Standard directly; Reuters, Bloomberg, The Economist, PRS and PIB through Google News), refreshed only when you press Refresh. Items older than 14 days are dropped and duplicates across sources are merged.
- News Desk topic tags: each Refresh tags new headlines as Economy, Reforms or Legislation with Claude Haiku 4.5 through OpenRouter, and moves off-topic ones to a Hidden tab. The page has a tab per topic with counts. A first refresh of 886 headlines measured ₹7; later refreshes should cost about ₹0.008 per new headline, extrapolated from that run (#253).
- News Desk indicators: a table of official MoSPI figures beside the headlines (retail inflation, food and beverages inflation, IIP growth, real GDP growth and urban unemployment), with the latest and previous values. Refresh updates them along with the headlines; a figure that fails to refresh keeps its last value and is marked stale (#253).
- News Desk chat: an Ask MoSPI panel answers questions about Indian official statistics from MoSPI's data, showing each step as it works and drawing a chart when the answer is a time series. A chart can be pinned into the indicator table, and pinned rows can be removed. Each question costs about ₹7, measured at ₹4.6–10.7 across three questions. A pinned row keeps the time window its question asked about and does not advance yet (#270).
- `/robots.txt`: disallows AI training and AI-scraping crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot and others) from the whole site, and keeps every crawler out of `/tools`, `/api/`, `/keystatic` and `/login`. Search engines can still index the public pages. It is advisory — crawlers that ignore robots.txt are not stopped.
- Money Planner tool at `/tools/money-planner`: from a balance, a monthly salary and itemized expenses on their own cadences, the date a purchase becomes affordable without leaving the next pay cycle short.
- Storybook for `web/components/`, and Chromatic visual regression on pull
  requests into `dev`. Every story is snapshotted in both light and dark.
  Storybook is installed locally but never run by `npm test` or
  `npm run lint` — all build cost is on CI.
- `deploy.yml` runs Playwright on Windows and macOS as well as Linux, on
  promotion PRs into `stage`/`main` and on `workflow_dispatch` only. The repo
  is private on GitHub Free (2,000 minutes/month) and macOS runners cost about
  10x Linux against that quota, so cross-OS on every PR would stall CI, and
  `release` with it, within days.
- A `security` job runs Trivy over the tree (npm lockfile vulnerabilities,
  Dockerfile and Terraform misconfiguration, secrets) at HIGH/CRITICAL with
  `ignore-unfixed`, and fails the run on findings. Results go to the job
  summary: SARIF upload, CodeQL and dependency review all need Advanced
  Security, which is paid on private repos. `.trivyignore` holds accepted
  findings with a reason each.
- A `summary` job writes one status table for the whole run.
- The `summary` job's table also reports the `chromatic` job (landed in
  #215), as a reported row only — it gates nothing.
- Playwright results and Trivy scan results are uploaded as artifacts
  (`playwright-results-<OS>` for 7 days, `trivy-results` — the JSON plus the
  rendered markdown — for 30). Nothing was downloadable from a run before
  this.

### Changed

- Mail sent through SES from `ashutosh-pandey.com` (Cognito sign-in codes, and later access emails) uses `mail.ashutosh-pandey.com` as its envelope sender, so SPF passes for the domain as well as DKIM. The bare domain publishes `v=spf1 -all`, since nothing sends with it as the envelope sender (#300).
- The Cognito sign-in page at `auth.ashutosh-pandey.com` uses the site's dark theme: its colours, square corners, the wordmark, the column rules and the loop ring, with the form on the left as on `/login`. The settings and images are in Terraform (`infra/main/branding.json`, `infra/main/branding/`), so a recreate restores them. Managed login has no font setting, so only the logos and background use the site's typefaces (#296).
- Signing in to the tools uses Cognito (Google, an email code or a passkey) at `auth.ashutosh-pandey.com`, and only the site owner's account is accepted. The shared password, its login endpoint and its rate limiter are removed (#290).
- The login redirect reads `/login?next=/tools/news-desk` instead of `/login?next=%2Ftools%2Fnews-desk` (#277).
- The S3 buckets are now `portfolio-data-<account>` (plus `-dev-` and `-stage-`), replacing `bgm-looper-audio-*`. They hold the resume and News Desk data as well as audio. S3 cannot rename a bucket, so the resume and News Desk data were copied into new buckets and the old ones deleted (#273).
- Buttons and the News Desk "sources failed" toggle show a pointer cursor across the site. News Desk links no longer change colour on hover, Refresh sits above the headline column, and the indicator table is centred in the window from the first paint and stays there while the headlines scroll.
- The ⌘K command bar opens with six pinned commands (`cd projects`, `cd resume`, `cd blog`, `cd contact`, `cd tools`, `theme`) and a count of the rest; typing still searches every command. `theme dark` and `theme light` are now one `theme` toggle.
- CI no longer emits Node 20 deprecation warnings or Ubuntu migration notices.
  `actions/upload-artifact` moves v4 to v7 and `actions/download-artifact` v4
  to v8 (both now run natively on Node 24 instead of being forced onto it),
  and every `runs-on` pins `ubuntu-24.04` instead of `ubuntu-latest`. The pin
  is behaviour-neutral today but has to be bumped by hand once Ubuntu 26.04
  is wanted. The Playwright report now travels inside its artifact under a
  `playwright-results-<OS>/` directory and the `summary` job downloads with
  `merge-multiple: true`, because download-artifact v5+ extracts a
  single-artifact pattern match flat and the cross-OS table would otherwise
  have rendered "no results found" on every run with one e2e leg.

### Fixed

- Command bar rows stay on one line. A long hint used to squeeze the command
  label until it wrapped (`open news-desk`); the label no longer shrinks and
  the hint truncates instead.
- The Money Planner e2e test "remembers a plan across a reload" waits for the
  login redirect before navigating to the planner. It used to navigate before
  the session cookie was set and intermittently landed on the sign-in page.
  Closes #247.
- Money Planner says a budget that breaks even does exactly that, instead of
  "you are ₹0 short each month". A monthly average that rounds to ₹0 counts
  as breaking even, so it no longer reads as "₹0 short" or "₹0 spare" either.
- Money Planner's "How this adds up" breakdown is a real table: Date, Item,
  Amount and Balance columns under a header, right-aligned tabular figures,
  and each date shown once for the events that share it. It scrolls inside
  the panel with the header pinned, and fits a phone-width screen without
  widening the page.
- Money Planner's number fields (balance, salary, pay day, price, expense
  amount) start blank with a greyed hint instead of a prefilled `0` or `1`,
  so what is typed is the whole value rather than landing after the default.
  A plan saved by an earlier version with nothing typed into it loads as the
  blank form. Blank fields now survive a reload as blank instead of `null`.
- `promotion-guard` and the release version bump resolve the last release
  with `git describe --match 'v[0-9]*'` rather than `'v*'`, so a stray
  non-release tag (`vtest`, `vnext`) reachable from `main` can no longer be
  returned as the last tag — which would have made the guard assert against
  the wrong tag and the bump compute its range from the wrong point.

- `changelog-sync.py` keys entries on their enclosing `###` heading as well
  as their text. Keying on text alone meant an entry recategorized on `dev`
  after a promotion matched the copy that shipped under a different heading
  on `main` and was dropped from `[Unreleased]` entirely. It now survives,
  and `main_only` goes non-zero so the sync PR title flags it for review.

- Vercel builds again on a `web/`-touching commit. The `ignore_command` on
  `vercel_project.looper` runs with the working directory set to
  `root_directory` (`web`), so its bare `web content` pathspecs resolved to
  `web/web` and `web/content`, never matched, and exited 0 — which Vercel
  reads as "skip". Every deployment on all three branches was silently
  canceled from the `app/` → `web/` rename onwards. The pathspecs now carry
  the `:(top)` prefix, anchoring them to the repo root.
- `trivy-results.json` and `trivy-summary.md` are gitignored. The `security`
  job writes both to the repo root, so running the scan locally left two
  untracked files — one a 240 KB SBOM — in `git status`, where a `git add -A`
  would sweep them into the tree.
- The Trivy summary reports what was scanned, not only what was found. A clean
  run used to render three lines beside a 240 KB report; it now carries a
  Coverage table (target, type, `366 packages` / `28 checks`, per-target
  finding count) and a `Trivy <version> · N targets · commit <sha>` footer. The
  table renders under the finding tables too, and a report with no targets at
  all now says so — "no findings" does not distinguish a scan that passed from
  one that covered nothing.
- Two summaries appended to the same job's step summary are separated by a
  blank line. The `summary` job writes both the run table and the e2e table,
  and the second one's heading used to land directly under the first's closing
  paragraph.

### Changed

- The three `e2e` matrix legs no longer write a summary each. They upload
  their reports and the `summary` job renders one spec × OS table, with a
  per-OS duration row — the first time CI has reported a duration anywhere,
  despite the minute budget being what shaped the matrix.
- Playwright results are read from `tests[].status` rather than
  `tests[].results[]`, so a retried test counts once instead of as both a
  pass and a failure, and a flake is labelled as one.
- The Trivy job emits JSON instead of an ASCII table, and the summary renders
  findings as three tables (vulnerabilities, misconfiguration, secrets) with
  advisory links and file/line links at the commit under test. Counting
  findings no longer means matching `Total:`/`Failures:` lines out of Trivy's
  own formatting. Secret findings report file and line only; Trivy's `Match`
  field is never printed.
- Summaries report counts as tables, list the five slowest tests, group
  failures by file, link to source, and strip the ANSI escapes Playwright
  puts in its error messages.
- `.github/scripts/test-summary.mjs` is now `unit-summary.mjs` (Vitest only)
  alongside a new `e2e-summary.mjs`, with the shared helpers in
  `summary-lib.mjs`.
- Spec paths in the e2e table are derived from each leg's own
  `config.rootDir` rather than assuming `playwright.config.ts`'s directory.
  Playwright sets `rootDir` to the project's `testDir`, so the assumed prefix
  produced `web/a11y.spec.ts` for a file at `web/e2e/a11y.spec.ts` and every
  link 404'd.

- The single `test` job is now `unit`, `lambda`, `e2e` and `security`, run in
  parallel; `deploy` and `release` gate on all four. Unit tests stay
  Linux-only: Vitest runs under jsdom over pure logic and the Lambda ships as
  a Linux container, so other OS legs would spend minutes for no signal.
- Superseded PR runs are cancelled by a `concurrency` group; push runs never
  are, so a cancellation cannot land mid-`deploy` or mid-`release`.
- `e2e` carries `timeout-minutes: 20`, so a hung browser on a matrix leg
  cannot burn the 6-hour default against the free-plan quota.
- `deploy` now also requires `github.ref_name` to be `main`, `dev` or
  `stage`. The `bgm-looper-ci-deploy` role's OIDC trust policy is
  `StringEquals` on exactly those three refs, so a `workflow_dispatch` from a
  feature branch previously ended in a red `deploy` that meant nothing. This
  was a latent gap, not one the job split introduced.
- `test-summary.mjs` takes `--label`, and the two new summary scripts are
  covered by `node --test ".github/scripts/*.test.mjs"` in the `unit` job.

### Fixed

- `CLAUDE.md` and the release-promotion runbook said the changelog-sync PR
  "does get CI — review it like any other", and told the reader to wait for
  those checks. The checks do run, but not unaided: because `github-actions[bot]`
  opens the PR, GitHub finishes the `pull_request` run as `action_required`
  without executing a job, so the test jobs and the readiness review are absent while
  Vercel still reports green. Waiting never completes, and absent checks read as
  "bot PRs don't get CI here" — the belief that wording existed to correct. Both
  documents now say the run is gated, give the approve command, and state that
  absent test jobs on a sync PR mean gated rather than skipped. #144, cited as
  proof the checks arrive unaided, carries the same manual-approval signature as
  #206. Closes #207.

### Security

- Every route sends `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy` that turns off camera, microphone and geolocation. Other sites can no longer frame `/login` or `/keystatic`. The CSP sets no `script-src`, which would need per-request nonces, and no `form-action`, because the newsletter form posts to Buttondown (#283).
- Every GitHub Action in `.github/workflows/` is pinned to a full commit SHA, with the version in a trailing comment. A repointed tag can no longer change what runs in `deploy`, which assumes the AWS deploy role. Dependabot bumps the SHA and the comment together (#283).
- `next` 16.3.4 → 16.3.8 for GHSA-vcvr-r3jv-pc5j (critical), and `brace-expansion` 2.1.4 → 2.1.7 for CVE-2026-102276 and CVE-2026-102278 (#304).

## [1.5.2] - 2026-09-17

### Fixed

- A transient `gh pr list` failure in the `release` job's changelog-sync step
  no longer bypasses the guard that refuses to re-open a sync PR a human closed
  without merging. `set -e` takes the exit status of `read`, not of the command
  substitution feeding its here-string, so the failure left `PR_STATE` empty and
  fell past the `CLOSED` arm into the one that assumes no PR exists, which
  force-pushes the branch and opens a fresh PR. The substitution is now its own
  assignment, where `set -e` sees it. Closes #200.
- The `release` job now opens the changelog-sync PR *before* creating the tag
  and the GitHub Release. The sync step became fatal on failure in #168's fix,
  which meant a sync failure published a release with no reconciliation behind
  it and left the operator to repair `dev` by hand. With the tag last, a
  failure leaves `main` carrying the changelog commit and nothing published,
  and re-running the job is the recovery path. Every step in that path is now
  idempotent by version: `changelog-release.py` matched on version *and* date,
  so a re-run on a later day inserted a second heading for the same version and
  filed the entries under the stale copy — the #168 shape, reachable through
  the new recovery path. The release creation is idempotent too, and the sync
  step never force-pushes the sync branch and leaves it alone when a sync PR
  for it exists in any state, so commits a human pushed to it cannot be made
  unreachable; a sync PR closed without merging is a fatal error rather than
  a silent skip, since the release it belongs to is then unreconciled.
  Closes #195.
- A `promotion-guard` job now fails any PR into `stage` or `main` whose head
  branch does not already contain the last release tag. That is exactly the
  state in which merging duplicates the version heading: it means the
  `chore/changelog-sync-*` PR has not been merged, or was merged with
  `--squash`, which is how v1.5.1 broke. Detection used to be possible only in
  the `release` job, after the promotion that caused the damage; this refuses
  the merge instead. The assertion is on the previous release tag, not on
  `main` being an ancestor of `dev` — that is false on every healthy run, since
  a promotion's merge commit lives only on the target branch. Branch protection
  is not enforced on this repo, so the guard is a red X rather than a hard
  block. Closes #196.
- Entries that land on `dev` between a promotion and the release are no longer
  filed under the version that did not ship them. The sync branch's
  `CHANGELOG.md` is now built by `.github/scripts/changelog-sync.py`, which
  copies `main`'s released section verbatim and re-adds only the un-promoted
  remainder under `## [Unreleased]` — dev's `[Unreleased]` body minus the body
  `main` filed under the version, matched per entry and insensitive to how the
  text happens to be wrapped. Copying rather than re-deriving the released
  section also removes the last way the two files could drift. Previously the
  step detected the race and asked a reviewer to move the entries back by hand.
  Entries present on `main` but not on `dev` are counted and called out in the
  PR title, since those mean a direct commit to `main` or a reword after the
  promotion. Covered by `.github/scripts/test_changelog_sync.py`, run by the
  `test` job. Closes #197.
- The `release` job's changelog-sync step now merges `main` into the branch it
  cuts from `dev` instead of cherry-picking the release commit onto it, and
  reconstructs `CHANGELOG.md` on that branch with the same transform `main`
  just ran (now shared as `.github/scripts/changelog-release.py`) rather than
  trusting git's merged result. A cherry-pick — and equally a squash-merge of
  the sync PR — leaves the release commit outside `dev`'s history, so the next
  `dev -> stage -> main` promotion still had a merge base predating the
  heading, saw two insertions under the same `## [Unreleased]` anchor, and
  emitted the heading twice with the new entries filed under the wrong copy.
  That is why v1.3.0 and v1.5.0 both needed hand repair. Merging makes the
  release commit an ancestor of `dev`, which retires the conflict class;
  merge the sync PR with `--merge`, never `--squash`. The step is also fatal
  on failure now instead of emitting a warning and letting `release` report
  success, and it flags in the PR title when entries landed on `dev` between
  the promotion and the release and so got filed under the new version.
  Closes #168.

## [1.5.1] - 2026-09-17

### Changed

- The Next.js project directory is now `web/` rather than `app/`. Next.js
  requires its App Router directory at `<project-root>/app`, so the old name
  produced `app/app/` for every router path. Nothing inside the project
  changed: its paths are all relative to the project root. What moved is every
  reference from outside it — `vercel_project.looper`'s `root_directory` and
  `ignore_command`, `deploy.yml`'s `working-directory` steps and test-report
  args, Dependabot's npm `directory`, and `.claude/rules/app.md` (now
  `web.md`). Historical entries here and under `docs/` still say `app/`; they
  describe what was true when written. Closes #180.
- `getPublishedResume` now returns `invalid: true` when a published
  `resume/current.json` is read but fails `resumeSchema`. That state previously
  returned a shape byte-identical to the nothing-published-yet one, so corrupt
  published data rendered as an ordinary first-run placeholder page with nothing
  but a log line to tell the two apart. Closes #112.
- `aws-actions/amazon-ecr-login` pinned to `v2.1.6` instead of floating on
  `@v2`, with a matching Dependabot ignore entry. v2.1.7 bundles an
  `@aws-sdk/core` new enough that the action's deprecated injected request
  handler logs a `JsonCodec2` deprecation warning on every ECR login. v2.1.7
  was dependency bumps only, so the pin gives up nothing. Unpin once
  aws-actions/amazon-ecr-login#1303 ships. Closes #174.

### Removed

- Both IAM users and their permanent access key pairs — `bgm-looper-vercel-sa`
  and `bgm-looper-ci-deploy` — along with their inline policies and the
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` Vercel environment variables.
  CI and the app both authenticate by assuming a federated role through OIDC,
  verified end to end on `dev`, `stage` and production first. There are now no
  long-lived AWS credentials anywhere in this project. Closes #155.
- The `vercel_access_key_id`, `ci_deploy_access_key_id` and
  `ci_deploy_secret_access_key` Terraform outputs, and the `AWS_CI_*` GitHub
  repository secrets they fed.

## [1.5.0] - 2026-09-16

### Added

- `aws_iam_openid_connect_provider.vercel` and `aws_iam_role.vercel` — a Vercel
  OIDC role carrying the five statements from `aws_iam_user_policy.vercel`, plus
  an `APP_AWS_ROLE_ARN` project environment variable holding its ARN. Nothing
  reads the variable yet; the app still authenticates with the static key pair.
- `aws_iam_openid_connect_provider.github` and `aws_iam_role.ci_deploy` — a
  GitHub Actions OIDC role carrying the same three statements as
  `aws_iam_user_policy.ci_deploy`. Its trust policy pins `sub` with
  `StringEquals` on the three permanent branches rather than a wildcard, so a
  fork PR's `pull_request` context cannot assume it. Nothing uses the role yet;
  `deploy.yml` still authenticates with the static key pair.
- `aws_cloudwatch_metric_alarm.lambda_invocation_rate` — one alarm per Lambda
  function, firing on more than 50 invocations in five minutes to the existing
  `bgm-looper-budget-alerts` SNS topic. This is the fast signal for a runaway
  invoke loop; the $5 budget lags actual usage by hours.
- `aws_sns_topic_policy.budget_alerts` now also allows `cloudwatch.amazonaws.com`
  to publish. That policy replaces SNS's default, so without the statement the
  alarms would transition to `ALARM` and notify nobody.
- `docs/research/2026-09-15-architecture-review.md` — a review of the whole
  system against the tree and the live account. Seven findings; the two worth
  acting on are the pair of permanent IAM access keys with no OIDC anywhere,
  and the absence of any concurrency ceiling on the Lambdas.
- `docs/runbooks/` — operator checklists for release promotion, stale-Lambda
  recovery, BGM Looper incident triage, and Terraform apply/teardown. Two
  corrections fall out of writing them: a `workflow_dispatch` run on `main`
  also cuts a release, and `terraform destroy` aborts with `BucketNotEmpty`
  because no bucket sets `force_destroy` and main's never empties itself.

### Changed

- The app's S3 and Lambda clients now federate through the Vercel OIDC token
  when `APP_AWS_ROLE_ARN` is set, via a new `awsCredentials()` helper in
  `app/lib/aws.ts`. With the variable absent the helper contributes nothing and
  the SDK's default credential chain still applies, so the unit tests,
  Playwright's self-hosted server and local `npm run dev` are unaffected.
- `deploy.yml`'s `deploy` job now authenticates to AWS by assuming
  `bgm-looper-ci-deploy` through GitHub Actions OIDC instead of the
  `AWS_CI_ACCESS_KEY_ID`/`AWS_CI_SECRET_ACCESS_KEY` secrets. The secrets stay in
  the repo, unreferenced, as the rollback; they are deleted once the Vercel
  runtime is federated too.
- #154 asked for `reserved_concurrent_executions = 2` on the Lambdas. It cannot
  be applied: this account's Lambda concurrency quota is 10, and AWS caps a
  reservation at unreserved concurrency minus 100, so any non-zero value is
  rejected. The quota is therefore the real ceiling (10 × 1024MB, ~$0.60/hour
  worst case). `ARCHITECTURE.md`, `docs/runbooks/incident-tool-down.md` and
  `.claude/rules/infra.md` now record that, with the verification output, and
  the incident runbook's throttle lever is documented as zero-or-nothing.
- `CLAUDE.md`'s stale-Lambda guidance now prefers `gh run rerun --failed` and
  states that a `workflow_dispatch` run on `main` also cuts a release. The old
  wording recommended dispatch as the fix without that side effect.

### Fixed

- `aws_iam_role.ci_deploy`'s trust policy pinned the name-only GitHub subject
  (`repo:<owner>/<repo>:ref:...`), which this repo never issues — it has
  `use_immutable_subject: true`, so the subject carries numeric owner and repo
  IDs. The first federated deploy failed at `Configure AWS credentials` with
  `Not authorized to perform sts:AssumeRoleWithWebIdentity`. The three subjects
  now use the immutable prefix.
- The newsletter admin now says `BUTTONDOWN_API_KEY is not set` when the key is
  missing, instead of `Status unknown` for every issue. The old fallback was
  indistinguishable from "nothing has been sent yet", so a broken integration
  looked like an empty archive. A configured key that still fails reports
  `Buttondown unreachable`, which is a different problem.

## [1.4.0] - 2026-09-14

### Added

- Newsletter archive at `/newsletter`, powered by the same Keystatic setup
  as the blog. Sending is manual: the gated `/tools/newsletter-admin` tool
  triggers delivery via Buttondown once an issue is reviewed.
- Vercel Web Analytics and Speed Insights on every route, mounted in the root
  layout. Both are free on the Hobby plan (50,000 analytics events/month,
  10,000 Speed Insights events per 30 days) and Analytics is cookie-free, so
  no consent banner is needed.
- Vercel WAF rate limit on `/api/login` — 10 requests per 600s per IP/JA4,
  denied for 10m. The app-level limiter in `app/lib/rate-limit.ts` counts in
  serverless instance memory and so cannot see attempts spread across cold
  starts; this one counts at the edge. Uses the single rate-limit rule the
  Hobby plan includes.

### Changed

- Vercel only builds when `app/` or `content/` changed, via `ignore_command`
  on the project. Commits touching only `lambda/`, `infra/`, `docs/` or
  `CHANGELOG.md` no longer produce a deployment — which also makes Instant
  Rollback useful, since the release job's CHANGELOG commit is no longer the
  deployment that a Hobby-plan rollback would land on.

## [1.3.1] - 2026-09-13

## [1.3.0] - 2026-09-13

### Security

- Resume extraction now checks the uploaded object's `%PDF-` header before
  calling the model. `/api/resume/upload-url` only validates the content type
  the caller declares in the request body, which says nothing about the bytes
  that actually land in S3, so any authenticated caller could spend OpenRouter
  tokens on arbitrary content that would never parse as a resume. A buffer too
  short to hold the header fails the comparison rather than slipping past it.
- The login endpoint is rate-limited to 5 attempts per IP per 15 minutes,
  returning 429 with `Retry-After`. The limiter is a fixed window held in
  module memory (`app/lib/rate-limit.ts`) — Vercel runs each serverless
  instance separately, so this is a speed bump rather than a distributed
  limit, deliberately traded against the cost of a shared store. The caller is
  identified from `x-real-ip`, falling back to the **last** `x-forwarded-for`
  entry: a caller can prepend entries to that header but not remove the one a
  proxy appends, so reading the first entry would let anyone mint a fresh
  bucket per request. The map of tracked windows is swept of expired entries
  and capped, so it cannot grow for the life of an instance. A successful login
  refunds that caller's window, so signing in legitimately — several devices
  behind one NAT, a cookie expiring, a tab reloaded — never locks you out; the
  check itself stays ahead of the password comparison, so the cap is on guesses
  rather than on error responses.
- Session cookies now carry a signed issued-at timestamp and expire
  server-side after 7 days. The signed payload was previously the constant
  `"authenticated"`, so every cookie was byte-identical and stayed valid
  until `COOKIE_SECRET` rotated; the response's `maxAge` was only a
  browser-side hint. **Existing sessions are invalidated — one re-login is
  required after deploy.**
- `checkPassword` no longer returns early on a length mismatch, which leaked
  the password length through timing and defeated the `timingSafeEqual` that
  followed it. Both sides are now hashed to a fixed 32 bytes first.
- Presigned upload URLs are signed with an explicit content length, so a URL
  can no longer be used to upload an arbitrarily large object (previously any
  size up to S3's 5 GB single-PUT ceiling). The client declares the size, the
  route rejects anything over 50 MB, and S3 enforces the signed value.

### Added

- The BGM Looper tool page is designed, in the same editorial system as the rest
  of the site: its own masthead (the tool sits outside the `(site)` group, so it
  renders the wordmark and its own `<CommandBar />` like the `/login` gate), a
  drop zone that also accepts drag-and-drop, and distinct decoding / uploading /
  processing / done / error states on one two-column layout.
- The waveform now corresponds to the actual audio rather than being decorative.
  The file you pick is decoded in the browser (`decodeAudioData` → 240 peak
  buckets, `lib/peaks.ts`) and drawn before anything is uploaded; the DSP
  pipeline computes the same 240 buckets for the processed result and returns
  them with what it decided — loop bounds, tempo, the crossfade it actually
  applied, and the target level — which `/api/looper/process` passes through as
  a typed `LoopResult`. A browser that can't decode the format falls back to a
  flat rest line and uploads anyway.
- The result plays through a custom transport whose playhead follows
  `audio.currentTime`, with click-to-seek, and the download link carries a
  countdown derived from the presigned URL's server-side 300s TTL.

- The ⌘K/Ctrl+K command bar now works on the `/login` gate, which renders its
  own `<CommandBar />` — it sits outside the `(site)` route group, so it didn't
  inherit one, and with no SiteHeader the shortcut is the only nav there besides
  the wordmark. The global handler's "don't hijack a focused form field" guard
  now exempts password inputs, so the shortcut works from the gate's password
  box too; every other field type still suppresses it. Gated pages behind the
  login still get no command bar.
- Project-scoped AWS budget ($5/month) with SNS email alerts. Deliberately
  unfiltered by tag rather than tag-filtered — this project's resources are not
  consistently tagged, so a tag filter would silently match nothing.
- Account-level S3 public access block, as a backstop so a future bucket cannot
  be created publicly accessible by accident.
- `RESUME_BUCKET_NAME`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and
  `OPENROUTER_BASE_URL` environment variables, for the resume pipeline.
- Resume admin pipeline at `/tools/resume-admin` (password-gated): upload a
  resume PDF, have it read by `anthropic/claude-haiku-4.5` via OpenRouter into
  a schema-validated JSON structure, correct anything that came out wrong in a
  live-validated editor, preview it, and publish. Publishing archives the
  previous `resume/current.{pdf,json}` under `resume/archive/<timestamp>` before
  promoting the draft, and revalidates the `resume` cache tag. Extraction is
  idempotent per draft so a page reload cannot spend another model call, and
  publishing is refused outside the production deployment — drafts stay
  writable on every branch so one reviewed on `dev` can be published from
  production unchanged.
- Two infrastructure changes the pipeline depends on, both applied: the Vercel
  service account now holds `s3:ListBucket` on the resume bucket, without which
  S3 answers `403` rather than `404` for a key that does not exist and every
  first extraction and first publish fails; and the Vercel project now exposes
  system environment variables, without which `VERCEL_ENV` is unset at runtime
  and the production-only publish gate refuses everywhere, including production.
- A tools hub at `/tools`, behind the same password, listing every gated tool
  with what it does. Before this, the resume admin and the Keystatic content
  editor had no link anywhere on the site — typing the URL was the only way in.
  A password-first login (one with no `?next`) now lands here rather than on the
  BGM Looper, and the command bar carries `cd tools`, `open resume-admin` and
  `open content-editor` alongside the existing `open bgm-looper`.
- `/resume` and `/about` now render the resume published through the admin
  pipeline, read from `resume/current.json` in S3 behind a cached, tagged read
  that the publish route revalidates. Both fall back to the placeholder content
  when nothing has been published, which is a tested path rather than a
  defensive one. The resume page gains a skills section.
- `.github/workflows/release-tests.yml` — manual-dispatch workflow that runs the
  AWS DevOps Agent's UI release testing against the `stage` deployment and
  reports the verdict as a GitHub Check Run. Needs the `DEVOPS_AGENT_WEBHOOK_URL`
  / `DEVOPS_AGENT_WEBHOOK_SECRET` repo secrets and the
  `DEVOPS_AGENT_TEST_PROFILE_ID` repo variable; setup and gotchas are in
  `docs/aws-devops-agent.md`.
- Vercel automation bypass token (`vercel_project_protection_bypass.automation`
  in `infra/main/shared.tf`) so the AWS DevOps Agent's release testing can reach
  the `stage` preview URL. Preview deployments stay behind Vercel
  Authentication; the agent's test profile URL carries
  `?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`
  instead. Read the secret with `terraform output -raw
  protection_bypass_secret`.

### Fixed

- The `/resume` page's Download PDF link no longer 404s. `/resume.pdf` is a
  route handler that redirects to a 300-second presigned GET of the published
  PDF, and the link is hidden entirely until a resume exists to download.
- The login page's "Continuing to → X" strip no longer disappears when `?next`
  carries a query or hash directly after a tool prefix (`/keystatic?path=posts`,
  `/tools/bgm-looper#top`). `parseNext` was handing the whole
  `pathname + search + hash` string to `toolNameFor`, whose prefix match needs a
  `/` boundary; it now returns the pathname and the full target separately, so
  the strip matches on the former while the post-login redirect still carries
  the latter. Display-only — the redirect itself was always correct, and
  `proxy.ts` only ever sets `next` to a bare pathname, so it took a hand-written
  URL to hit.
- `lambda/Dockerfile` now fetches ffmpeg with `curl -fL` instead of `curl -L`.
  Without `-f`, curl exits 0 on an HTTP error and writes the error page to
  `ffmpeg.tar.xz`, so the build failed a layer later with a misleading
  `xz: (stdin): File format not recognized` — as it did on the v1.2.0
  promotion. `-f` fails at the fetch with curl exit 22 and the real status
  code instead. The same fetch now also retries with `--retry 3
  --retry-delay 5`, so a transient `johnvansickle.com` blip (connection
  timeout or 5xx — the failure mode that has broken `deploy` twice) is
  ridden out in-build rather than needing a `workflow_dispatch` rerun. A
  permanent error such as a 404 still fails on the first attempt.

### Changed

- The header no longer shows a `⌘K` / `Ctrl K` button. The command bar is
  unchanged and the shortcut still works everywhere, including on the login
  gate — it is simply no longer advertised.

- The login page moved from `/tools/bgm-looper/login` to `/login` and is now a
  general gate for every tool on the site rather than the looper's own. It is
  designed in the portfolio's editorial system (Instrument Serif masthead over
  a 2px rule, the twelve-column hairline backdrop, the LoopRing as the site's
  mark) instead of being unstyled, and names the tool the visitor was heading
  to — resolved from `?next` through a new `toolNameFor()` in
  `app/lib/route-gate.ts`, which renders nothing for a destination it doesn't
  recognise rather than printing a raw path back. Stale links to the old path
  now redirect through the gate and land on the tool after signing in.

- CI `test` job now runs `npm run lint` alongside the Vitest and Playwright
  suites, and fails the job if lint fails. Lint was previously outside the CI
  gate entirely, so a dependency bump that broke the lint toolchain showed all
  checks green — as the ESLint 10 bump did (#68, tracked in #79). Lint runs
  before the test suites but only reports its exit code, so a lint error no
  longer hides the test results.
- Vercel Authentication is now disabled for preview deployments
  (`vercel_authentication = { deployment_type = "none" }`), making the `dev` and
  `stage` URLs publicly reachable. The AWS DevOps Agent's UI release testing
  cannot use a protection bypass token — it navigates to sub-paths directly, so
  the token in the test profile's query string is never carried over, and plan
  generation truncates it when the agent tries to re-add it. `APP_PASSWORD` still
  gates `/tools/bgm-looper`, `/api/looper` and `/keystatic` independently.
- S3 lifecycle rules are now prefix-scoped: audio scratch and resume drafts
  expire after 1 day, resume archives after 365 days, and the live resume never
  expires. The single blanket rule it replaces would have deleted a stored
  resume the day after upload.
- Bucket CORS is scoped to the app's own origins instead of `*`.
- The Vercel IAM user's S3 access is scoped to specific prefixes rather than
  whole buckets, and gains `DeleteObject` on resume drafts only.
- The password now gates the whole `/tools` namespace rather than one prefix per
  tool, so the hub itself is behind it and a page added under `/tools` is gated
  before anyone remembers to list it. `app/lib/route-gate.ts` also gained
  `TOOLS`, one list of the gated tools that the hub, the login page's
  "Continuing to → X" strip and the command bar all read.

## [1.2.0] - 2026-09-04

### Security

- Bumped the transitive `nanoid` (3.3.16 → 3.3.18, GHSA-2v37-7h3g-55p8) and
  `js-yaml` (4.3.0 → 4.3.2, GHSA-5p4m-2wfm-xmqj) in `app/package-lock.json`,
  clearing both open Dependabot alerts. Lockfile-only; neither was reachable
  with untrusted input (nanoid comes in via build-time postcss, js-yaml via
  eslint and Keystatic's parsing of repo-authored frontmatter).

### Added

- Playwright end-to-end and accessibility test suite (`app/e2e/`) covering all
  seven public pages: page loads, header navigation, theme-toggle persistence,
  and an axe-core scan per page. Runs against a real Next.js server on port
  3100 via `npm run test:e2e`.
- Unit-test coverage for the two known gaps: `SiteFooter` and the blog list /
  post-detail pages.
- `app/TESTING.md` — testing conventions, including how to unit-test async
  server components and when to reach for e2e instead.
- `.github/scripts/test-summary.mjs` — parses both runners' JSON reports into
  a GitHub Actions job summary with pass/fail counts and collapsed failure
  details. The `test` job now runs Vitest and Playwright and reports both.
- `.github/dependabot.yml` — weekly update checks for npm (`app/`), pip
  (`lambda/`), GitHub Actions, and Terraform (`infra/*`). PRs use a `chore`
  Conventional Commit prefix so the `release` job can still derive the
  version bump from them.

### Changed

- CI `test` job now runs on Node 22 (was Node 20). Node 20 lacks
  `v8.markAsUncloneable` (added in 22.12), which undici 8's `CacheStorage`
  requires — pinning to 20 blocks the pending jsdom 30 bump, whose engines
  range starts at `^22.22.2`.

- Home page recomposed so the animated waveform clears the fold at 1440x900:
  the name and a new `FeaturedTool` block share one 12-column band (the h1
  drops from 148px to 104px), the figure moves directly beneath it, and the
  intro paragraph plus pipeline-settings table drop below it. The page's
  bottom "Open the tool" bar is gone — the featured-tool block now owns that
  call to action.

- Public portfolio redesigned as an editorial system: a warm paper ground and
  matching warm near-black dark mode, Instrument Serif + IBM Plex Sans loaded
  through `next/font/google` (self-hosted, no `fonts.googleapis.com` link), a
  visible 12-column grid with ruled rows instead of cards and terminal chrome,
  a shared bar envelope rendered both as the home page's waveform and as the
  About page's `LoopRing`, and a new `/projects/[slug]` detail page with an
  optional demo-GIF slot. Hover motion is gated with `motion-reduce:` and every
  looping animation has a `prefers-reduced-motion` off-switch.

- Portfolio accent swapped from the warm amber/VU-meter tone to a cool
  teal (`#187a73` light, `#5ec8c0` dark), with the secondary greys
  re-tinted to match. Includes the terminal chrome's own accent, which
  phase 2 had hardcoded to the old amber. All new pairs verified at WCAG
  AA (≥4.5:1) by a new `contrastRatio` utility and regression test.

- `README.md` reframed around the portfolio site rather than the BGM Looper
  tool: public pages first, the password-gated tools listed as a table, and
  architecture split into the site vs. the per-tool AWS backend.

### Fixed

- Line endings normalized to LF across the repo, pinned by a new
  `.gitattributes` — editors on Windows were writing CRLF back over blobs
  git stored as LF, so any touched file surfaced as a whole-file diff.
- `npm run lint` in `app/` restored: `typescript` pinned back from `^7.0.2` to
  `~5.9.3`. `typescript-eslint` (pulled in by `eslint-config-next`) declares
  `typescript: >=4.8.4 <6.1.0` and throws at ESLint config-load time on TS 7,
  so the command exited 2 without linting anything. Dependabot now ignores
  `typescript >=6` until typescript-eslint ships TS 7 support
  (typescript-eslint#10940). CI was unaffected — it runs no lint step and
  Next 16's `next build` no longer runs ESLint.

## [1.1.0] - 2026-08-01

### Added

- Public portfolio site: home, about, projects, resume, and contact pages,
  no login required.
- Dark/light theme toggle in the site header, dark by default, with the
  choice persisted in `localStorage`.
- Blog, powered by Keystatic (git-backed CMS). Admin UI at `/keystatic`
  (behind the existing password). Public posts at `/blog`.

### Changed

- The BGM Looper tool moved from `/` to `/tools/bgm-looper`, still behind
  the same password gate.

## [1.0.1] - 2026-07-31

### Changed

- CI actions bumped to node24-runtime versions (`actions/checkout` v7,
  `actions/setup-python` v7, `actions/setup-node` v7,
  `aws-actions/configure-aws-credentials` v6) — silences the "Node.js 20 is
  deprecated" warning GitHub Actions was printing on every run.

## [1.0.0] - 2026-07-31

### Added

- Initial release: single-user background-music looper — upload an audio
  file, get back a loudness-normalized, silence-trimmed, beat-aligned,
  crossfaded seamless loop. Next.js frontend on Vercel, Python DSP pipeline
  on a containerized AWS Lambda.
- Three-environment branch strategy: permanent `dev` → `stage` → `main`
  branches, each with its own Vercel deployment and its own AWS backend
  (Lambda + S3), promoted via PR.
- Shared ECR repo with per-branch image tag prefixes and independent
  lifecycle pruning, so one branch's image churn can't evict another's.
- Automatic GitHub Release + version tag on every push to `main`, versioned
  from Conventional Commit prefixes since the last tag.

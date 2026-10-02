# AWS DevOps Agent

Setup notes and usage best practices for the AWS DevOps Agent instance scoped
to this project. See https://docs.aws.amazon.com/devopsagent/latest/userguide/
for the official product docs.

## Agent Space

- Name: `bgm-looper`
- Agent Space ID: `bbfee9b3-446d-46b4-89e5-5a25fa1fc1ec`
- Region: `us-east-1`

Deliberately scoped to exactly this project — one AWS account, one repo, no
other integrations. Verify with `list_associations` before adding anything
else; a wider scope defeats the point of a project-scoped agent.

| Association | Detail |
|---|---|
| AWS account | `223376380711` (personal), role `DevOpsAgentRole-AgentSpace-y365argo`, `accountType: monitor` (read-oriented, full-account visibility) |
| GitHub repo | `DataCrusade1999/supreme-enigma`, `READ_WRITE`, capabilities: `RELEASE_READINESS_REVIEW`, `RELEASE_READINESS_REVIEW_AUTOMATED_TESTING` |

Creating the Agent Space itself and attaching the AWS account/GitHub repo
requires the **AWS Console** (DevOps Agent console → Agent Space → configure
primary account access + web app access, both via IAM role — auto-create is
the simple path). The MCP/CLI tools can create the space (`create_agent_space`)
and query it, but there's no tool to create an association — that's a
console-only step (cross-account trust + GitHub App install).

The **Operator access** button on the Agent Space details page opens the
IAM-authenticated web app — that's where a human reviews investigations
day-to-day; the MCP tools here are for driving it from Claude Code instead.

## What it's used for here

- **Release readiness review** — analyze the diff between `dev` and `main`
  before promoting, or a specific PR, for policy compliance, IAM blast
  radius, dependency breakage, cross-repo impact.
- **Cost / recommendations / ad-hoc chat** — quick natural-language queries
  against the account without console-hopping.
- **Incident investigation** — root-cause a Lambda/CI failure by correlating
  logs, deploys, and code diff (not yet exercised on this project).

## Best practices / gotchas learned

- **Automated PR reviews run only on private repositories.** AWS's docs: "DevOps Agent does not automatically review pull requests or merge requests on public repositories." This repo is public, and the last automatic review was #349 on 2026-10-02 (#361). `list_tasks` with `task_type: RELEASE_READINESS_REVIEW` shows whether one was ever created. Request reviews with `create_release_readiness_review`; the result is a report (`recommendedAction`, `risks`), with no commit status and no inline comments. Making the repo private again restores the automatic reviews, and brings back the 2,000-minute Actions cap with them.
- **Static-only by default.** `skip_automated_testing: true` for a release
  readiness review unless you specifically want it to spin up a sandbox and
  run generated UI/API tests — static analysis is faster and cheaper, and
  covers policy/IAM/dependency risk, which is most of what matters for a
  small single-account project.
- **No open PR needed.** For a `dev`→`main` promotion review (this repo's
  actual release flow — see root `CLAUDE.md`), pass
  `githubPrContent: [{repository: "owner/repo", headBranch: "dev"}]` with no
  `prNumber`. The agent diffs the branch directly; it doesn't require an
  actual pull request to exist.
- **Journal records can be huge.** `list_journal_records` with `order: ASC`
  and no limit on a multi-commit review can return 500k+ characters and blow
  past tool output limits. Poll with `order: DESC, limit: 3-5` to check
  recent progress instead of pulling the full transcript.
- **Poll `get_task` on a ~30s cadence** until `status` is one of `COMPLETED`,
  `FAILED`, `CANCELED`, `TIMED_OUT`, then call `get_release_readiness_report`
  with the `executionId` for the actual findings.
- **On a PR, the verdict and the findings live in two different places.** The
  approve/reject verdict is a **commit status** (`gh api
  repos/<owner>/<repo>/commits/<sha>/status`, not `.../check-runs`); the
  findings are **inline review comments** (`gh api --paginate
  repos/<owner>/<repo>/pulls/<N>/comments` — `--paginate` matters, the REST
  default is 30 per page and a truncated read hides later findings). `gh pr
  view <N> --json
  reviews,comments` shows neither usefully — it returns the review summary body,
  which is routinely empty, plus issue-level comments. The two are independent:
  the agent approved #83 and filed a correctness bug on it in the same run, so
  a green verdict never means "no findings". Check both before merging; missing
  this is what let #83 merge with a known bug, fixed after the fact in #84.
- **`list_recommendations` starts empty.** Proactive recommendations only
  populate after the agent has run investigations/reviews over time — an
  empty result on a freshly created space is expected, not a misconfiguration.
- **Keep the scope narrow on purpose.** Don't add secondary AWS accounts,
  extra repos, or third-party integrations (observability tools, ticketing)
  unless this project actually needs them — the value of a project-scoped
  agent is that its topology and blast-radius reasoning stay limited to what
  you attached.

## Release testing (UI) — `.github/workflows/release-tests.yml`

Manual-dispatch workflow that runs the agent's UI release testing against the
`stage` deployment and reports the verdict as a GitHub Check Run.

```bash
gh workflow run release-tests.yml --ref dev   -f test_requirement="verify the home/about/projects nav and the resume page"
```

Use `--ref dev` until the file has been promoted to `stage`/`main` — the run
tests the stage URL either way (that comes from the test profile, not the ref).

**The action name in the AWS docs is wrong.** The prose says
`aws-actions/devops-agent-release-testing@v1`; that repo 404s. The real action
is `aws-actions/devops-agent-qa@v1` — which is what the doc's own YAML sample
uses. Only the `v1` tag is published.

Configuration (all console-only on the AWS side — there is no MCP or CLI tool
to create a webhook or a test profile; `create_release_testing_job` only
consumes an existing profile id):

| Where | What |
|---|---|
| Console → Agent Space → **Capabilities** → Webhook → Generate | Auth type **HMAC** (the action signs HMAC-SHA256). Secret is shown once — download the CSV. Auth type is fixed for the webhook's life; to switch, delete and recreate. |
| Web app → **Release Manager** → Test profiles → Add | Type **UI testing**; target URL is the plain stage URL, no query params. Yields a `ki-…` id. |
| Repo secrets | `DEVOPS_AGENT_WEBHOOK_URL`, `DEVOPS_AGENT_WEBHOOK_SECRET` |
| Repo variable (`gh variable set DEVOPS_AGENT_TEST_PROFILE_ID --body ki-…`) | `DEVOPS_AGENT_TEST_PROFILE_ID` (the `ki-…` id — not a secret, kept out of the workflow file so rebuilding the profile doesn't need a PR) |

Do all of the above **before** the first dispatch: an unset `vars.*` renders as
an empty string rather than erroring, so a premature run fails inside the action
rather than at input validation.

**What the action actually puts on the wire** (from its `dist/index.js` — AWS
documents only the `eventType: "incident"` investigation payload, so this is
recorded here rather than guessed at later):

```json
{
  "eventType": "deployment_completed",
  "testProfileId": "ki-...",
  "testRequirement": "...",
  "repository": "owner/repo",
  "headSha": "...",
  "prNumber": null
}
```

Profileless mode replaces `testProfileId` with
`testProfileValues: { testAgentType, targetUrl, apiSpec? }`. The envelope is the
same as the documented incident one — HMAC-SHA256 over `` `${timestamp}:${payload}` ``,
base64, in `x-amzn-event-signature` alongside an `x-amzn-event-timestamp` of the
form `2026-09-05T00:00:00.000Z`. So a single generic **HMAC** webhook serves both
investigations and release testing; that is why HMAC (not API key) is the right
choice when generating it. The action retries once after 2s on a 403, and
resolves `prNumber` via `listPullRequestsAssociatedWithCommit`, leaving it
`null` on a direct push or a manual dispatch.

**The agent cannot use a Vercel protection bypass token** — this cost a whole
run (execution `6d2c9593`, 12/12 test cases blocked) before it was understood.
Two independent reasons:

1. The token only lives in the test profile URL's query string. When a test
   intent names a specific page, the agent navigates **directly** to that path
   (`/resume`), never loading the profile URL, so `x-vercel-set-bypass-cookie`
   never fires and no cookie is established.
2. When the agent tries to re-add the token itself, it only has what survived
   plan generation — the report records *"partial bypass token"* and
   *"truncated in user request"*. It never sees the full 32 characters.

Hence `vercel_authentication = { deployment_type = "none" }` on the project: the
preview URLs are simply public. Do not "fix" this by putting the bypass params
back on the test profile URL — that configuration was tested and does not work.

**The agent's browser cannot resize the viewport**, so mobile-responsiveness
test cases come back `Blocked` no matter what. Don't write intents that ask for
them; Playwright's projects in `web/playwright.config.ts` are the right tool for
viewport testing.

Gotchas:

- **`workflow_dispatch` only lists branches where the file already exists**, and
  the Check Run lands on that branch's HEAD SHA. The file lands on `dev` first,
  so until it is promoted you must dispatch `--ref dev` — the run still tests
  the *stage* URL (that's baked into the test profile, not the workflow), but
  the check attaches to a `dev` commit. Promote through `dev → stage → main` as
  usual and this resolves itself.
- **The agent performs real writes** (POST/PUT/DELETE) while exploring. Against
  stage that means real uploads to `portfolio-data-stage-*` and real
  `bgm-looper-processor-stage` invocations. Objects expire after 1 day, so the
  cost is bounded but not zero.
- **`/tools/bgm-looper` is not reachable by the agent.** The Vercel bypass gets
  it past Vercel Authentication, but `web/lib/route-gate.ts` gates the tool,
  `/api/looper`, and `/keystatic` behind the Cognito sign-in independently. Scope
  `test_requirement` to the public portfolio pages; the agent cannot complete a
  Google, email-code or passkey sign-in.
- The profileless path (`target-url` + `agent-type: ui` inputs, no profile) is
  in the action's `action.yml` but undocumented by AWS — treat it as a fallback.

## Sample review: `dev` → `main` (2026-08-06)

First real run, reviewing 29 commits (Next.js 15→16 upgrade, CI/CD refactor,
ECR lifecycle tightening, doc additions). Static-only, no PR needed — took
~5 min end to end.

**Verdict:** Deploy with Caution. Three low-severity findings, all
verification gaps rather than confirmed bugs:

1. **Dependency compatibility unverified** — `@keystatic/next` (`^5.0.4`) and
   `next-mdx-remote` (`^6.0.0`) weren't co-bumped with `next` (`^16.0.0`); if
   either declares a `next<16` peer dep, Keystatic/MDX could break at
   install or runtime. Fix: run `npm run build` locally, load `/keystatic`
   and `/blog/hello-world` before merging.
2. **New ESLint flat-config not covered by CI** — `eslint.config.mjs`'s new
   `eslint-config-next@16` subpath-import pattern is untested by CI, since
   the `test` job runs `npm test` but not `npm run lint`. Fix: run
   `npm run lint` locally; consider adding a lint step to CI.
3. **`release` job can run even if the `changes` job fails** — a failed
   `changes` job makes `deploy` show `skipped` (not `failed`), which
   satisfies `release`'s current non-failure check. Low likelihood
   (`actions/checkout` rarely fails), but `deploy.yml`'s `release` condition
   could add `needs.changes.result == 'success' || 'skipped'` for certainty.

Confirmed correct (no issues raised): the `middleware.ts`→`proxy.ts` rename,
the CI `changes`-job path-filter logic itself, and the ECR keep-5→keep-1
retention change (doesn't threaten in-use images).

Full report (with file/line evidence and monitoring runbook) is in the
Agent Space journal — `execution_id: c51c75a5-48da-5875-870d-6cc9424e8206`,
retrievable via `get_release_readiness_report`.

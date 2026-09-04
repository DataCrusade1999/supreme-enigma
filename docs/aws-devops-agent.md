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
- **`list_recommendations` starts empty.** Proactive recommendations only
  populate after the agent has run investigations/reviews over time — an
  empty result on a freshly created space is expected, not a misconfiguration.
- **Keep the scope narrow on purpose.** Don't add secondary AWS accounts,
  extra repos, or third-party integrations (observability tools, ticketing)
  unless this project actually needs them — the value of a project-scoped
  agent is that its topology and blast-radius reasoning stay limited to what
  you attached.

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

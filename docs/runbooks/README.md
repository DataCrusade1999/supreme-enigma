# Runbooks

Operator checklists for this repo. Each one is the *what to type*; the *why*
lives in the documents they link to — `CLAUDE.md` (branch model, PR review
sequence), `.claude/rules/infra.md` (Terraform per-file detail),
`ARCHITECTURE.md` (resource map and cost), `docs/aws-devops-agent.md`
(the review/investigate agent).

| Runbook | Use it when |
|---|---|
| [release-promotion.md](release-promotion.md) | Shipping work from `dev` to `stage` to `main`. |
| [stale-lambda-recovery.md](stale-lambda-recovery.md) | The DSP pipeline is suspected to be running an old image. |
| [incident-tool-down.md](incident-tool-down.md) | BGM Looper is failing for a user. |
| [infra-apply-teardown.md](infra-apply-teardown.md) | Running `terraform plan`/`apply`, or the kill switch. |
| [link-owner-google.md](link-owner-google.md) | Once, after access control ships: make Google sign in as the owner user. |

## Shared prerequisites

Every runbook assumes:

- `gh` authenticated against `DataCrusade1999/supreme-enigma`.
- AWS CLI with the `personal` profile configured (account `223376380711`).
  **Pass `--profile personal --region us-east-1` on every command** — the
  profile's own default region is `ap-south-1`, and omitting `--region`
  returns a `ResourceNotFoundException` that reads like a deleted resource.
- Vercel dashboard access for the `bgm-looper` project (the Terraform
  resource is `vercel_project.looper`; the project itself is named from
  `var.project_name`, which is `bgm-looper`).

Commands are written for Git Bash on Windows, which is what this repo is
developed on. One consequence: any argument starting with `/` is rewritten
into a Windows path before the AWS CLI sees it, so CloudWatch log group names
need `MSYS_NO_PATHCONV=1` in front of the command. Without it you get

```
InvalidParameterException: Value at 'logGroupNamePrefix' failed to satisfy
constraint: Member must satisfy regular expression pattern: [\.\-_/#A-Za-z0-9]+
```

which looks like a bad log group name and is not.

## Escalation

There is no on-call rotation — this is a single-operator project. "Escalate"
means one of:

- **Diagnosis you cannot finish**: hand it to the AWS DevOps Agent's
  `investigate` flow (`docs/aws-devops-agent.md`, "What it's used for here").
  It takes 5–8 minutes and returns journal records.
- **Runaway cost**: the `$5` `bgm-looper-monthly-cap` budget notifies
  `bgm-looper-budget-alerts`. Confirm it can actually reach you before
  relying on it — see [infra-apply-teardown.md](infra-apply-teardown.md#verify-the-budget-alarm-can-reach-you).
- **Nothing else works**: the kill switch in
  [infra-apply-teardown.md](infra-apply-teardown.md#kill-switch-full-teardown).
  Read its warnings first; it takes the public portfolio down too.

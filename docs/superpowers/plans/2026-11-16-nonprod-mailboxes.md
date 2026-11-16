# Mailboxes for dev and stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zoho receives `access@` and `no-reply@` on `dev.` and `stage.ashutosh-pandey.com`, the owner can reply as them, and each nonprod account's SES suppression list is in Terraform. Dev and stage stay in the SES sandbox.

**Architecture:** Zoho console steps come first, because they produce each subdomain's DKIM key. One PR into `dev` then adds Zoho's MX, SPF and DKIM records at `<env>` and the suppression list to `infra/modules/nonprod-account/email.tf`, with each environment's DKIM key passed in from its `account` stack. Dev applies on merge. Stage applies at the next `dev → stage` promotion.

**Tech Stack:** Terraform (`vercel/vercel` and `aws` providers already locked in each stack), Vercel DNS, Zoho Mail Lite (India data center), Amazon SES v2.

**Spec:** `docs/superpowers/specs/2026-11-16-nonprod-mailboxes-design.md`

## Global Constraints

- Every `vercel_dns_record` sets `team_id = var.vercel_team_id`, `domain = var.dns_domain`, `ttl = 1800`.
- MX hosts and priorities: `mx.zoho.in` 10, `mx2.zoho.in` 20, `mx3.zoho.in` 50, unless the console shows other values.
- SPF at `<env>`: `v=spf1 include:zoho.in -all`. Exactly one `v=spf1` TXT at that name.
- DKIM selector `zoho`, 2048-bit, at `zoho._domainkey.<env>`.
- Suppression: `suppressed_reasons = ["BOUNCE", "COMPLAINT"]`, which is already live in both accounts.
- No reputation alarms and no SES production access for dev or stage (spec non-goals).
- Zoho values are public DNS data. Hardcode them in `.tf` files, not tfvars.
- No change to `infra/prod/**` or to `web/`.
- Every manual `aws` call names `--profile` (`personal-dev-ro` or `personal-stage-ro` for reads) and `--region us-east-1`.
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`. The PR body says `Closes #542`.

## Review Focus

1. **A DKIM key pasted with quotes, spaces or line breaks.** Zoho's DKIM check fails even though DNS resolves. Task 1 copies the key as one unbroken string, and Task 4 compares the published TXT with the console's value.
2. **A second `v=spf1` TXT at `<env>`.** That is a permerror and fails SPF for every Zoho reply. Task 4 checks there is exactly one.
3. **MX records live before Zoho hosts the subdomain.** Zoho would reject mail. Task 1 turns on Mail Hosting before Task 3's PR merges.
4. **Stage's stack missing its key.** `zoho_dkim_key` is required, so the promotion plan would fail. Task 2 sets both stacks, and its validate step covers `infra/stage/account`.
5. **Replies sent from the primary address.** Zoho's default From is the mailbox's primary address. Task 4's reply test picks `access@dev.` in the From menu, or the DMARC check proves nothing.
6. **A test address that bounces gets suppressed.** It then silently receives nothing from dev or stage. Task 2's runbook edit covers removing it.

---

### Task 1: Zoho console setup for both subdomains (manual: the owner, or Claude in Chrome with the owner's console URL)

**Files:** none.

**Interfaces:**
- Produces: two DKIM strings, `DKIM_DEV` and `DKIM_STAGE`, each `v=DKIM1; k=rsa; p=…`. Also the console's MX hosts and SPF include for each subdomain. Task 2 consumes all of them.

- [ ] **Step 1:** In Admin Console → Domains → +Add, enter `dev.ashutosh-pandey.com`. Expected: it is added without an ownership step, because the parent is verified. If Zoho asks for a TXT or CNAME, record the value and stop: Task 2 then also needs the spec's optional `zoho_verification` input.
- [ ] **Step 2:** Turn **Mail Hosting Status** on for `dev.ashutosh-pandey.com`.
- [ ] **Step 3:** Email Configuration → DKIM for the subdomain: add selector `zoho`, 2048-bit. Copy the TXT value as one unbroken string, with no surrounding quotes and no breaks inside `p=`. Save it as `DKIM_DEV`.
- [ ] **Step 4:** Read the MX and SPF pages for the subdomain. Expected: `mx.zoho.in` 10, `mx2.zoho.in` 20, `mx3.zoho.in` 50, and `include:zoho.in`. Note any difference.
- [ ] **Step 5:** Users → owner → Mailbox Settings → Email Alias → Add: alias `access` on domain `dev.ashutosh-pandey.com`, then alias `no-reply` on the same domain. Expected: both are listed under the owner's aliases.
- [ ] **Step 6:** Repeat Steps 1–5 for `stage.ashutosh-pandey.com`, saving `DKIM_STAGE`.
- [ ] **Step 7:** Check: Domains lists both subdomains with mail hosting on, and the owner has 4 new aliases. `DKIM_DEV` and `DKIM_STAGE` differ.

### Task 2: Terraform records, suppression list and docs

**Files:**
- Modify: `infra/modules/nonprod-account/email.tf` (header comment, plus new resources after `mail_from_spf`)
- Modify: `infra/modules/nonprod-account/variables.tf` (new variable)
- Modify: `infra/dev/account/main.tf` and `infra/stage/account/main.tf` (`module "account"` argument)
- Modify: `docs/runbooks/nonprod-email-testing.md`, `.claude/rules/infra.md` (the "apex's mail records belong to Zoho" bullet), `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1's `DKIM_DEV`, `DKIM_STAGE`, and the MX and SPF values.
- Produces: `variable "zoho_dkim_key"` (string, required, `description` saying it is Zoho's DKIM TXT for selector `zoho` on `<env>`, copied from the console). Resources: `vercel_dns_record.zoho_mx` (`for_each` keyed `"10"`/`"20"`/`"50"`), `vercel_dns_record.zoho_spf`, `vercel_dns_record.zoho_dkim`, `aws_sesv2_account_suppression_attributes.account`. Task 3 reads these addresses in the plan.

- [ ] **Step 1: Branch.** The spec and this plan landed in their own docs PR. Run `git switch dev && git pull && git switch -c feat/nonprod-mailboxes-infra`.
- [ ] **Step 2: Variable.** Add `zoho_dkim_key` to `variables.tf`, with no default.
- [ ] **Step 3: DNS records.** In `email.tf`, add `local.zoho_mx` (priority to host) and `zoho_mx` with `name = var.env`, `type = "MX"`, `mx_priority = tonumber(each.key)`, copying production's shape. Add `zoho_spf` (`name = var.env`, TXT, the Global Constraints value) and `zoho_dkim` (`name = "zoho._domainkey.${var.env}"`, TXT, `value = var.zoho_dkim_key`). Each gets a one-line comment. On `zoho_spf`, the comment says SES never uses `<env>` as its envelope domain, so Zoho is its only entry.
- [ ] **Step 4: Suppression list.** Add `aws_sesv2_account_suppression_attributes.account` with the Global Constraints value. Its comment says it codifies what is already set, so a rebuild keeps it.
- [ ] **Step 5: Header comment.** Rewrite the file header:
  - Zoho receives `<env>` mail and can send as it.
  - `access@` and `no-reply@` are Zoho aliases of the owner's mailbox (#542).
  - The account stays in the SES sandbox. Only production has production access.
  - Bring the sandbox sentence up to date: recipients are the owner and hand-verified test addresses.
- [ ] **Step 6: Inputs.** In `infra/dev/account/main.tf` set `zoho_dkim_key = "<DKIM_DEV>"`, and in `infra/stage/account/main.tf` set `"<DKIM_STAGE>"`, each with a one-line comment: Zoho DKIM for this subdomain, from the console (#542).
- [ ] **Step 7: Check for placeholders.** Run `git grep -n "DKIM_DEV\|DKIM_STAGE" infra/`. Expected: no output.
- [ ] **Step 8: Format and validate.** Run `terraform fmt -check -recursive infra/`. Expected: no output, exit 0. Then run `terraform -chdir=infra/dev/account init -backend=false -lockfile=readonly && terraform -chdir=infra/dev/account validate`, and the same for `infra/stage/account`. Expected: `Success! The configuration is valid.` twice. tflint runs in CI.
- [ ] **Step 9: Runbook.** In `docs/runbooks/nonprod-email-testing.md`:
  - Replace the "Replies to `access@<env>` bounce" bullet with: replies and SES bounce notices to `access@<env>` and `no-reply@<env>` land in the owner's Zoho inbox (aliases, #542).
  - Add a bullet: a test address that bounces or complains is put on the account's suppression list and receives nothing more. Check with `aws sesv2 get-suppressed-destination --email-address "$ADDR" --profile "$RO" --region us-east-1`, and remove with `aws sesv2 delete-suppressed-destination --email-address "$ADDR" --profile "$PROFILE" --region us-east-1`.
- [ ] **Step 10: Rules.** Extend the Zoho bullet in `.claude/rules/infra.md`. Dev's and stage's `<env>` MX, SPF and `zoho._domainkey.<env>` belong to Zoho too (`infra/modules/nonprod-account/email.tf`, #542), with the same rule: no second MX and no second `v=spf1` at that name. Each environment's DKIM key is `zoho_dkim_key` in its `account` stack.
- [ ] **Step 11: Changelog.** Add under `[Unreleased]` → `### Added`: `- Zoho receives mail for access@ and no-reply@ on dev's and stage's subdomains and can send as them, and both accounts' SES suppression list is in Terraform (#542).`
- [ ] **Step 12: Commit.** Message: `feat(infra): Zoho mailboxes for dev and stage`, with the sign-off.

### Task 3: PR into `dev` and merge

**Files:** none.

**Interfaces:**
- Consumes: Task 2's branch and resource addresses.

- [ ] **Step 1:** Push the branch and open a PR into `dev` titled `feat(infra): Zoho mailboxes for dev and stage`. The body summarizes the spec and says `Closes #542`.
- [ ] **Step 2: Read the plan the `Terraform` workflow posts.**
  - `dev/account` must show `Plan: 6 to add, 0 to change, 0 to destroy.`: `zoho_mx["10"]`, `["20"]`, `["50"]`, `zoho_spf`, `zoho_dkim` and the suppression attributes.
  - `dev/app` must show `No changes.`
  - `prod/account` shows only what `dev` already has ahead of `main`, and nothing from this PR.
  - No `⚠ destroys or replaces` and no `⚠ forgets`.
- [ ] **Step 3:** Invoke the `merging-a-pr` skill and follow it, including its rule on whether this infra PR needs a devops agent review. Merge with `gh pr merge <N> --squash --delete-branch`.
- [ ] **Step 4:** Confirm the `Terraform` apply run on the `dev` push succeeded: `gh run list --workflow terraform.yml --branch dev --limit 1` shows `completed success`.

### Task 4: Verify dev

**Files:** none.

- [ ] **Step 1: DNS.**
  - `nslookup -type=MX dev.ashutosh-pandey.com 1.1.1.1` lists exactly the three Zoho hosts.
  - `nslookup -type=TXT dev.ashutosh-pandey.com 1.1.1.1` shows exactly one `v=spf1 include:zoho.in -all`.
  - `nslookup -type=TXT zoho._domainkey.dev.ashutosh-pandey.com 1.1.1.1` shows `DKIM_DEV`. Once the resolver's chunks are joined, it matches the console string character for character.
  - `nslookup -type=MX mail.dev.ashutosh-pandey.com 1.1.1.1` still shows `feedback-smtp.us-east-1.amazonses.com`.
- [ ] **Step 2: Zoho.** In the console, verify MX, SPF and DKIM for `dev.ashutosh-pandey.com`. Expected: all three verified.
- [ ] **Step 3: Receiving.** From an outside account (not the owner's mailbox), send one email each to `access@dev.ashutosh-pandey.com` and `no-reply@dev.ashutosh-pandey.com`. Expected: both arrive in the owner's Zoho inbox.
- [ ] **Step 4: Sending.** In Zoho, reply to the Step 3 email with `access@dev.ashutosh-pandey.com` chosen as From. In the outside account, open the original headers. Expected: `spf=pass`, `dkim=pass` with `d=dev.ashutosh-pandey.com`, and `dmarc=pass`.
- [ ] **Step 5: SES.** `aws sesv2 get-account --profile personal-dev-ro --region us-east-1 --query SuppressionAttributes` lists `BOUNCE` and `COMPLAINT`.
- [ ] **Step 6:** Comment the results on #542, which the merge closed.

### Task 5: Stage, at the next `dev → stage` promotion

**Files:** none.

- [ ] **Step 1:** On the promotion PR, `stage/account`'s plan shows the same 6 additions. It also shows the MAIL FROM resources from #538, if they haven't been promoted yet. Nothing is destroyed. Merging into `stage` needs the owner's explicit OK for that PR.
- [ ] **Step 2:** Once the `stage` apply succeeds, run Task 4's Steps 1–5 with `stage` in place of `dev` and `personal-stage-ro` as the profile. Comment the results on #542.

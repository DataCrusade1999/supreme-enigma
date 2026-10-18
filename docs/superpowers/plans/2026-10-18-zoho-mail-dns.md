# Zoho Mail for ashutosh-pandey.com — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Zoho Mail mailbox at `<name>@ashutosh-pandey.com`, with `access@` as an alias, receives and sends mail for the domain, while SES keeps sending Cognito codes.

**Architecture:** Zoho owns the apex MX, the apex SPF and its own DKIM selector. SES keeps its custom MAIL FROM (`mail.`), its three DKIM CNAMEs and the shared `_dmarc` record. All records are `vercel_dns_record` resources in `infra/shared/email.tf`, applied by CI when a PR merges to `dev`. It takes two PRs, because Zoho shows the MX, SPF and DKIM values only after you verify the domain, which needs the verification TXT already published.

**Tech Stack:** Terraform, `vercel/vercel` provider (`~> 5.15`, locked at 5.18.0), Vercel DNS, Zoho Mail Lite (India data center).

**Spec:** issue [#403](https://github.com/DataCrusade1999/supreme-enigma/issues/403). The design is its body and its three comments ("Review findings, 2026-10-08/09", "Thunderbird setup", "Gmail app and Thunderbird sign-in"). There is no separate spec. Where the body and the comments disagree, the comments win. The comments correct the body on the SES sandbox, the SPF include and `dig`.

## Global Constraints

- Every placeholder for a value that comes from Zoho's admin console is written `<console: …>`. Before each PR, `git grep -n "<console:" infra/` must return nothing.
- Zoho values are public DNS data. Hardcode them in `email.tf`, not in tfvars.
- New records follow the existing style: `team_id = local.vercel_team_id` (the domains API answers `forbidden` without it, `.claude/rules/infra.md`), `domain = vercel_project_domain.custom.domain`, apex `name = ""`, `ttl = 1800`. MX values have no trailing dot.
- `vercel_dns_record.apex_spf` keeps its address. Only `value` changes, so the plan shows an in-place update. A rename would destroy the record and create a new one, and the apex would briefly have no SPF.
- Exactly one `v=spf1` TXT at the apex, ever. Two is a permerror.
- SPF ends in `~all` until a test message shows `spf=pass`. Changing it to `-all` is not part of this plan.
- Keep the verification TXT after Zoho verifies the domain. Removing it is a destroy, and a DNS change can send the domain back to "Yet to reverify".
- Both PRs go into `dev` from `dev`, squash-merged through the `merging-a-pr` skill. PR 1 says `Part of #403`. PR 2 says `Closes #403`.
- Each PR gets a devops agent release-readiness review. The skill counts a plan that creates a resource as a significant infra change, and both plans create records. `shared` applies when the PR merges to `dev`, so the `dev → stage` review comes after the records are already live in production. Request the review once the `Terraform` plan comment is posted. Only `Standard Deployment` lets the PR merge.
- A fix found after PR 2 merges (the 1024-bit DKIM fallback, a wrong SPF include) needs a new `bug` issue first, because #403 is closed by then. The PR closes that issue instead.
- Every manual `aws` call uses `--profile personal-ro --region us-east-1`.
- Commits end with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.

## Review Focus

1. **2048-bit DKIM value through the provider.** It has never been written through `vercel_dns_record`. Vercel has to serve it as split strings that join back into the full key, and the provider has to read it back as the same string, or every later `shared` plan shows a change. Task 6, Step 5 checks the published value against the console's, and Step 6 checks that a fresh plan is clean. If the published value is wrong, fall back to a 1024-bit key.
2. **India vs. US Zoho values.** The help pages print `.com` hosts and `include:zohomail.com`, which covers none of the India relays. Task 3 copies only from the console. Task 6 shows `spf=pass` in a real header.
3. **A kill-switch re-apply with the mail records out of state.** It creates a second apex `v=spf1` TXT (permerror, so mail is rejected) and duplicate MX. Task 5's runbook makes import mandatory before the full apply and says why.
4. **#300's PR 3 built from its old plan.** It would add SES's MX at priority 10 next to Zoho's, so incoming mail would split between them. Task 5 rewrites that spec and plan in the same PR that makes Zoho own the MX.
5. **Cached DNS after an apply.** With a 1800 s TTL, a resolver can show old answers for up to 30 minutes. Every DNS check queries Vercel's authoritative server, `ns1.vercel-dns.com`.

---

### Task 1: Sign up for Zoho and get the verification value (manual, the owner)

Do this only when PR 1 can merge the same day. One Zoho help page says a domain left unverified for 7 days is deleted. That isn't confirmed, so don't leave the gap open.

- [ ] **Step 1:** At zoho.com/in/mail, sign up for **Mail Lite 5 GB**, yearly, 1 user, with **India** as the country. It costs ₹708 plus GST (about ₹835) and auto-renews. Zoho refunds in full within 45 days.
- [ ] **Step 2:** Confirm the account lives on `accounts.zoho.in`. If it is on `accounts.zoho.com`, the organization is in the US data center and none of the `.in` values apply. Stop and fix that first.
- [ ] **Step 3:** Turn on two-factor authentication for the account at accounts.zoho.in. It is the organization's admin and will hold the mail sent to `access@`.
- [ ] **Step 4:** Confirm auto-renew is on for `ashutosh-pandey.com` at its registrar. An expired domain invalidates Zoho's verification, and whoever registers it next receives the mailbox's mail, password resets included.
- [ ] **Step 5:** Add the domain `ashutosh-pandey.com`, choose TXT verification, and copy the value: `zoho-verification=zb<digits>.zmverify.zoho.in`.

**Produces:** the verification value, used in Task 2.

---

### Task 2: PR 1, the verification TXT

**Files:**
- Modify: `infra/shared/email.tf`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the verification value from Task 1.
- Produces: `vercel_dns_record.zoho_verification`. Task 5's runbook names it.

- [ ] **Step 1:** Branch: `git switch dev && git pull && git switch -c feat/zoho-verification`.
- [ ] **Step 2:** In `email.tf`, after `apex_spf`, add `resource "vercel_dns_record" "zoho_verification"`: `name = ""`, `type = "TXT"`, `value = "<console: zoho-verification=…>"` replaced with the real value, and the standard attributes. Above it, a one-line comment: Zoho Mail domain verification (#403), kept after verifying because removing it can make Zoho ask to verify again.
- [ ] **Step 3:** Add `CHANGELOG.md`, `[Unreleased]` → `### Added`: `- Zoho Mail domain-verification record on ashutosh-pandey.com. Part of #403.`
- [ ] **Step 4: Static checks.** From the repo root:
  ```bash
  terraform fmt -check -recursive infra/
  tflint --chdir=infra --init --config="$PWD/infra/.tflint.hcl" && tflint --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"
  git grep -n "<console:" infra/
  ```
  Expected: fmt and tflint print nothing and exit 0. The grep finds nothing. If `tflint` isn't installed locally, skip it: the `Terraform` workflow runs the same `fmt -check` and tflint on the PR.
- [ ] **Step 5:** Commit `email.tf` and `CHANGELOG.md` as `feat(infra): add Zoho Mail domain verification record`, with the sign-off. Push, and open a PR into `dev` whose body says `Part of #403`.
- [ ] **Step 6: Read the plan the `Terraform` workflow posts.** Expected: `shared` shows `Plan: 1 to add, 0 to change, 0 to destroy.`, the add being `vercel_dns_record.zoho_verification`, and every other stack shows `No changes.`. No `⚠ destroys or replaces` line.
- [ ] **Step 7:** Request the release-readiness review (Global Constraints), then merge through the `merging-a-pr` skill. Wait for the apply on `dev`: `gh run list --workflow terraform.yml --branch dev --limit 1`, then `gh run watch <id>`. Expected: success.
- [ ] **Step 8: Check DNS.** `nslookup -type=TXT ashutosh-pandey.com ns1.vercel-dns.com`. Expected: the `zoho-verification=…` string and, unchanged, `v=spf1 -all`.

---

### Task 3: Verify the domain, create the mailbox, copy the values (manual, the owner)

- [ ] **Step 1:** In the Zoho admin console, press **Verify**. Expected: the domain shows as verified.
- [ ] **Step 2:** Create the mailbox user `<name>@ashutosh-pandey.com`. Add `access@ashutosh-pandey.com` as an **alias** of that user, not a group. If Zoho answers "This operation has been restricted", email support-as@zohocorp.com. They lift it in 24–48 hours, and nothing else waits on it.
- [ ] **Step 3:** In Email Configuration → DKIM, add selector **`zoho`** with a **2048-bit** key. Copy the TXT value, `v=DKIM1; k=rsa; p=…`, as one unbroken string: no surrounding quotes, and no line breaks or spaces inside `p=` if the console wraps it or splits it into quoted chunks. If the console won't create a selector yet, note when it allows one. Issue #403 left that open.
- [ ] **Step 4:** From the console's MX and SPF pages, copy the MX hosts with their priorities, and the SPF include. Expected: `mx.zoho.in` 10, `mx2.zoho.in` 20, `mx3.zoho.in` 50, and `include:zoho.in` or `include:zohomail.in`. If the console shows anything else, use the console's values.

**Produces:** the MX map, the SPF include and the DKIM value, used in Task 4.

---

### Task 4: PR 2, the MX, DKIM and SPF records

**Files:**
- Modify: `infra/shared/email.tf`

**Interfaces:**
- Consumes: Task 3's values.
- Produces: `vercel_dns_record.zoho_mx` (`for_each`, keys `"10"`, `"20"`, `"50"`), `vercel_dns_record.zoho_dkim`, and the changed `vercel_dns_record.apex_spf`. Task 5 names all three.

- [ ] **Step 1:** Branch: `git switch dev && git pull && git switch -c feat/zoho-mail-dns`. Tasks 4–6 share this branch and this PR.
- [ ] **Step 2: MX.** Add `local.zoho_mx = { "10" = "mx.zoho.in", "20" = "mx2.zoho.in", "50" = "mx3.zoho.in" }`, priority to host, adjusted to the console's values. Add `resource "vercel_dns_record" "zoho_mx"` with `for_each = local.zoho_mx`, `name = ""`, `type = "MX"`, `value = each.value`, `mx_priority = tonumber(each.key)`, and the standard attributes. The map is keyed by priority so that each instance's address stays stable if a host name changes.
- [ ] **Step 3: DKIM.** Add `resource "vercel_dns_record" "zoho_dkim"`: `name = "zoho._domainkey"`, `type = "TXT"`, `value` = the console's DKIM string. It sits next to SES's `<token>._domainkey` CNAMEs without conflict, because the names differ.
- [ ] **Step 4: SPF and comments.**
  - `apex_spf.value` becomes `"v=spf1 include:<console: zoho.in or zohomail.in> ~all"`, replaced with the real include.
  - Rewrite its comment. Zoho sends with the bare domain as envelope sender, SES still uses `mail.` and needs no entry here, and `~all` stays until a header shows `spf=pass` (#403).
  - Rewrite the file header. It now covers two senders, SES (Cognito codes, later the News Desk digest and #300's access emails, through MAIL FROM `mail.`) and Zoho Mail (the mailbox, `access@` an alias, apex MX/SPF and DKIM selector `zoho`). It also states SES production access, granted 2026-10-01 (`ProductionAccessEnabled: true`). The "stays in the SES sandbox" sentence goes.
  - The comment on `aws_sesv2_email_identity.owner` ("In the sandbox SES delivers only to verified addresses…") becomes: the owner's address stays a verified identity, though delivery to it no longer depends on that since production access was granted. Don't use the word "sandbox", so that Task 5, Step 7's grep stays clean. Leave the resource in place, because removing it is a destroy and is out of scope.
- [ ] **Step 5: Static checks.** Run the three commands from Task 2, Step 4. Expected: the same clean output.
- [ ] **Step 6:** Commit: `feat(infra): point ashutosh-pandey.com mail at Zoho`, with the sign-off.

The posted plan and the DNS checks for this task run in Task 6, after the docs commits are on the same branch.

---

### Task 5: PR 2, the docs (kill switch, #300, infra rules)

**Files:**
- Modify: `docs/runbooks/infra-apply-teardown.md`, `README.md`, `docs/superpowers/specs/2026-09-29-access-control-design.md`, `docs/superpowers/plans/2026-09-29-access-control-email.md`, `.claude/rules/infra.md`

**Interfaces:**
- Consumes: the resource addresses from Tasks 2 and 4.

- [ ] **Step 1: The runbook's kill switch.** In `docs/runbooks/infra-apply-teardown.md` → "Kill switch: full teardown", add a subsection before the destroy loop, **Keep the domain's mail records**. It says that destroying `shared` deletes every `vercel_dns_record` in the stack, so mail to the domain would bounce while Zoho keeps billing. Before the loop, from `infra/shared` with `AWS_PROFILE=personal`:
  1. Write down each record's ID, with `terraform state show '<address>'` (the `id` line) for each of `vercel_dns_record.zoho_verification`, `vercel_dns_record.zoho_mx["10"]`, `["20"]`, `["50"]`, `vercel_dns_record.zoho_dkim`, `vercel_dns_record.apex_spf` and `vercel_dns_record.dmarc`. If state is already gone, use `GET https://api.vercel.com/v4/domains/ashutosh-pandey.com/records?teamId=<team_id>` with the Vercel token. The team ID is `local.vercel_team_id` in `infra/shared/shared.tf`.
  2. `terraform state rm vercel_dns_record.zoho_verification vercel_dns_record.zoho_mx vercel_dns_record.zoho_dkim vercel_dns_record.apex_spf vercel_dns_record.dmarc`. The bare `zoho_mx` address removes all three instances.

  `dmarc` is on the list because it is the domain's policy for Zoho mail as well as SES mail. The SES DKIM CNAMEs and the `mail.` records go with SES.
- [ ] **Step 2: The runbook's recovery.** In "Recovery: applying from scratch afterwards", step 1, insert after the `-target=aws_ecr_repository.looper` apply and before the full `infra/shared` apply: import each record, one call per instance, `terraform import -var-file=terraform.tfvars '<address>' <team_id>/<record_id>`, for example `terraform import -var-file=terraform.tfvars 'vercel_dns_record.zoho_mx["10"]' team_xxx/rec_xxx`. Import evaluates the configuration, so without `-var-file` it stops on `shared`'s seven required variables. Then the reason, in one sentence: an apply with these records out of state creates a second `v=spf1` TXT at the apex, a permerror that gets the domain's mail rejected, plus duplicate MX records and a second `_dmarc` TXT, which receivers treat as no DMARC policy. The full apply should then show `No changes` for them.
- [ ] **Step 3: README.** In "Tearing everything down (kill switch)", next to the existing bucket warning, add one sentence linking to the runbook's new subsection: the mail DNS records have to leave state before the destroy and come back by import before a re-apply.
- [ ] **Step 4: The #300 spec** (`2026-09-29-access-control-design.md`). Keep SES sending from `access@` and drop SES receiving:
  - §2 (line 27): mail to `access@` reaches the owner's Zoho inbox (an alias, #403).
  - §3, the "Inbound mail" row: Zoho Mail, `access@` an alias of the owner's mailbox. Why: a domain has one MX set, and Zoho owns it (#403).
  - §7 "Receiving": replace it with two sentences. Zoho owns the apex MX (`infra/shared/email.tf`, #403), and `access@` is a Zoho alias, so nothing in AWS receives mail. Remove the receipt rule set, the S3 action, the `mail_forwarder` description and "No other address…".
  - §7 "Sending": the SES production access bullet becomes "granted 2026-10-01". "replies arrive through the receiving path" becomes "replies land in the owner's Zoho inbox".
  - §8 `email.tf`: keep only `aws_sesv2_account_suppression_attributes`. Remove the MX, receipt rules, bucket policy, `inbound-mail/` lifecycle rule, `mail_forwarder` and its role and permission. In the closing paragraph, drop the `hashicorp/archive` sentences.
  - §10: drop the `mail_forwarder` pytest bullet. Manual step 5 becomes "Email `access@` from that account → it lands in the owner's Zoho inbox".
  - §11: in part 3, drop "The MX record, receipt rules, `mail_forwarder`", and drop the production access request, which is already done. In "Docs updated", drop the `.claude/rules/infra.md` receipt-rule and forwarder clause, and the `email.tf` header clause (this plan rewrites that header).
  - §12: drop the "SES receiving" and "`mail_forwarder` Lambda, S3" rows, drop "50 emails in" from the assumptions, and recompute the total.
- [ ] **Step 5: The #300 PR 3 plan** (`2026-09-29-access-control-email.md`):
  - Goal, Architecture and Tech Stack: remove receiving, S3, `mail_forwarder`, pytest and `hashicorp/archive`.
  - Global Constraints: remove the bullets on main's bucket, the forward `From:`, the subject prefix, `inbound-mail/` expiry, the receipt rule set, `lambda/src/mail_forwarder/` and `lambda/.venv`. Change the first PR to Task 2 only.
  - Review Focus: remove items 1–3, which are forwarder-only. Mark item 4 (sandbox) as moot since 2026-10-01, or replace it with a real failure mode for sending.
  - Delete Task 1 (`mail_forwarder`). Cut Task 2 to the SES send permission, `ACCESS_FROM_EMAIL` and the suppression list. Remove its archive provider and lifecycle steps, the receiving resources, and the header comment it writes into `email.tf` (lines ~305–309), which would overwrite Task 4's header.
  - Task 3 (request production access): replace it with "Done 2026-10-01; confirm with `aws sesv2 get-account --profile personal-ro --region us-east-1` → `ProductionAccessEnabled: true`."
  - Task 6: drop the receiving bullet for `.claude/rules/infra.md`. Rewrite its SPF bullet: the apex SPF includes Zoho, and a new sender must be added to it. Drop receiving from the `ARCHITECTURE.md` line and the CHANGELOG line, and drop `lambda` pytest from Step 3. Manual checks 1 and 5 become "lands in the Zoho inbox".
  - Renumber the tasks and fix the cross-references ("Tasks 1–2", "Tasks 4–6", the Consumes lines).
- [ ] **Step 6: `.claude/rules/infra.md`.** Add one gotcha bullet: **The apex's mail records belong to Zoho (#403)**: the MX, the verification TXT, DKIM selector `zoho._domainkey` and `apex_spf`. Don't add another apex MX (receivers would split mail between providers) or a second `v=spf1` TXT (permerror). A new service that sends as the bare domain goes into `apex_spf`'s include list. The kill switch has to `state rm` and re-import these (runbook).
- [ ] **Step 7: Leftover check.**
  ```bash
  git grep -n -E "inbound-smtp|mail_forwarder|receipt rule|inbound-mail" -- docs/superpowers/specs/2026-09-29-access-control-design.md docs/superpowers/plans/2026-09-29-access-control-email.md
  git grep -n -i "sandbox" -- infra/shared/ .claude/rules/infra.md ARCHITECTURE.md README.md
  ```
  Expected: the first grep returns only lines saying receiving was dropped for Zoho. The second returns nothing in `infra/shared/`. The nonprod modules' sandbox mentions are correct (dev and stage accounts are still in the sandbox) and are out of scope. Older specs and plans (`2026-09-28-*`) are historical and stay as written.
- [ ] **Step 8:** Commit: `docs: Zoho owns the apex mail records; drop SES receiving from #300`, with the sign-off.

---

### Task 6: PR 2, CHANGELOG, plan check, merge, acceptance

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: CHANGELOG**, under `[Unreleased]`:
  - `### Added`: `- Mail for ashutosh-pandey.com: Zoho Mail receives it (MX), and Zoho can send as the domain (DKIM selector zoho, SPF include). access@ is an alias of the mailbox. Closes #403.`
  - `### Changed`: `- The kill-switch runbook keeps the domain's mail DNS records out of the destroy and re-imports them before a re-apply. #300's email design no longer receives mail through SES.`
  - If PR 1's `### Added` line is still under `[Unreleased]` (no release since), delete it. The new line covers it.
- [ ] **Step 2:** Run the Task 2, Step 4 checks again. Commit (`docs(changelog): Zoho Mail`, with the sign-off), push, and open the PR into `dev` with `Closes #403`.
- [ ] **Step 3: Read the posted plan.** Expected: `shared` shows `Plan: 4 to add, 1 to change, 0 to destroy.` The adds are `zoho_mx["10"]`, `["20"]`, `["50"]` and `zoho_dkim`. The change is `apex_spf`, `value` only. Every other stack shows `No changes.`. No `⚠ destroys or replaces` line. Anything else, stop.
- [ ] **Step 4:** Request the release-readiness review (Global Constraints), then merge through the `merging-a-pr` skill (squash, delete the branch). Wait for the apply on `dev`, as in Task 2, Step 7.
- [ ] **Step 5: Check DNS** against `ns1.vercel-dns.com`:
  - `nslookup -type=MX ashutosh-pandey.com ns1.vercel-dns.com` shows exactly Zoho's three hosts and priorities.
  - `nslookup -type=TXT ashutosh-pandey.com ns1.vercel-dns.com` shows exactly one `v=spf1` string, containing Zoho's include, plus the verification string.
  - The DKIM record, joined and compared in PowerShell, since `nslookup` prints a 2048-bit key as several quoted strings that are easy to misjoin by eye:
    ```powershell
    ((Resolve-DnsName zoho._domainkey.ashutosh-pandey.com -Type TXT -Server ns1.vercel-dns.com).Strings -join '') -ceq '<zoho_dkim.value from email.tf>'
    ```
    Expected: `True`. If the apply failed on this record or this prints `False`, generate a 1024-bit key under the same selector in Zoho, update `zoho_dkim.value` in a follow-up PR, and repeat this check.
- [ ] **Step 6: The plan is clean after the apply.** From `infra/shared`, after `terraform init`: `AWS_PROFILE=personal terraform plan -var-file=terraform.tfvars -lock=false`. Without a local `terraform.tfvars`, run `gh workflow run terraform.yml --ref dev -f stack=drift` instead, then `gh run list --workflow terraform.yml --branch dev --event workflow_dispatch --limit 1` for its ID and `gh run watch <id>`. The dispatch returns before anything is planned, so don't tick this step until the run finishes. Expected: `No changes.` for `shared` locally; for the drift run, success and no new comment or issue under `gh issue list --label drift` (the job files one only when a stack drifts). A change on `zoho_dkim.value` means the provider reads the value back in a different form from the one it wrote, and every later `shared` plan will show it. File a `bug` issue before the next `shared` change merges.
- [ ] **Step 7: Zoho console (owner).** Enable DKIM for selector `zoho`. Expected: domain, MX, SPF and DKIM all show verified.
- [ ] **Step 8: Mail round trip (owner).**
  - From an outside Gmail account, send to `<name>@` and to `access@`. Both arrive in the Zoho inbox.
  - Reply from Zoho. It lands in Gmail's inbox, not spam. "Show original" shows `SPF: PASS`, `DKIM: PASS` and `DMARC: PASS`. If SPF isn't `PASS`, the include is wrong: fix it in a follow-up PR (DMARC still passes on DKIM meanwhile).
- [ ] **Step 9: Clients (owner).** Turn on IMAP (Settings → Mail Accounts → IMAP Access, and Admin Console → Email Policies). Create an app password on accounts.zoho.in → Security → App passwords (two-factor is on since Task 1, so the account password won't work in a client). Set up Thunderbird with `imappro.zoho.in:993` SSL and `smtppro.zoho.in:587` STARTTLS, the full address as username, "Normal password" authentication with the app password, replacing the `imap.`/`smtp.` hosts Thunderbird fills in. Add `access@` as a second identity. Optionally add the Gmail app: Add another account → Other → Personal (IMAP). Expected: you can receive, and send as both addresses.
- [ ] **Step 10: SES still works.** Sign in at https://ashutosh-pandey.com/login with email. The Cognito code arrives, and its headers show `DKIM: PASS` for `ashutosh-pandey.com` and SPF for `mail.ashutosh-pandey.com`.
- [ ] **Step 11:** Tick #403's acceptance criteria, replacing `dig` with the `nslookup` commands above. The issue closes when PR 2 merges into `dev`.
- [ ] **Step 12: #300's issue body.** Its last acceptance criterion still describes the SES forward ("reaches the owner's inbox with Reply-To set to the sender"). Change it to "Mail to access@ashutosh-pandey.com reaches the owner's Zoho inbox (#403); approve, grant and revoke send the invitee an email from that address", and drop "SES inbound mail" from its Motivation. Task 5 changed the spec and plan; the issue body is what PR 3 is checked against.
- [ ] **Step 13: Follow-up issue.** File a `chore` issue to move `apex_spf` to `-all` and `_dmarc` from `p=none` to `quarantine`, once headers from both senders show SPF and DKIM passing. Until then nothing asks receivers to reject or quarantine mail forged as the domain. It can also add `rua=` pointing at a new Zoho alias: `dmarc`'s comment rules `rua=` out only because it would publish the owner's address.

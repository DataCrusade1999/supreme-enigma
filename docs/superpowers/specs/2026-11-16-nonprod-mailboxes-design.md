# Mailboxes for dev and stage — design

Issue #542. Research findings are in the issue's first comment.

## Why

Dev and stage send email from addresses nobody receives:

- Access emails go out from `access@<env>.ashutosh-pandey.com` (#530) with that address as Reply-To.
- Cognito's sign-in codes go out from `no-reply@<env>.ashutosh-pandey.com` (`infra/modules/nonprod-account/auth.tf`).
- SES forwards bounce and complaint notices to the sending address (`FeedbackForwardingStatus: true` on both identities, checked 2026-11-16), so those notices go nowhere either.

`<env>` has no MX record today, so all of this mail is undeliverable. Production doesn't have this gap: Zoho receives `access@` and `no-reply@` as aliases of the owner's mailbox (#403).

Dev and stage stay in the SES sandbox. Only production has SES production access, so only verified test addresses receive these emails. The fix is still worth making: replies from testers, and SES's notices about test mail, should reach the owner the way they do on production.

## Goals

- Mail to `access@<env>` and `no-reply@<env>` lands in the owner's Zoho inbox, for `dev` and `stage`.
- The owner can reply from Zoho as `access@<env>` and pass DMARC (aligned SPF and DKIM).
- SES bounce and complaint notices from dev and stage reach the owner.
- Each nonprod account's suppression list (BOUNCE and COMPLAINT) is in Terraform. It is already on in both accounts (checked 2026-11-16), so a rebuild must not silently drop it.
- SES's own records at `<env>` (DKIM CNAMEs, `mail.<env>` MAIL FROM) are unchanged.

## Non-goals

- SES production access for dev or stage. Only production gets it.
- Production's bounce and complaint rate alarms (#510). In the sandbox only verified test addresses receive mail, so the rates have nothing to warn about.
- Any change to the web app or to how emails are sent.
- A separate `_dmarc.<env>` record. The apex `p=quarantine` already covers subdomains.
- Subdomain stripping or domain aliasing in Zoho (approach B below).

## Anti-goals

- Any change to production's apex mail records in `infra/prod/account/email.tf`.
- A second MX provider at `<env>`, or a second `v=spf1` TXT at `<env>`.

## Constraints

- **Zoho plan:** Mail Lite 5 GB, one user, India data center. Paid accounts allow 30 domains per organization and 30 addresses per mailbox. Adding two subdomains and four aliases costs ₹0.
- **Verification:** `ashutosh-pandey.com` is verified in Zoho, so its subdomains need no ownership record. Zoho's Add Domains page lists ownership proof only when the parent domain is unverified. If the console asks for one anyway, see "Left to the builder".
- **Zoho's DKIM key exists only after the subdomain is added in the console.** The console steps therefore come before the Terraform PR.
- **Both environments use one DNS zone.** The records are `vercel_dns_record` resources in `infra/modules/nonprod-account`, each with `team_id = var.vercel_team_id` (`.claude/rules/infra.md`).
- **Apply timing:** `dev/account` applies on a push to `dev`, and `stage/account` on a push to `stage`. Stage's records go live only at the next `dev → stage` promotion.
- **Zoho values are public DNS data.** They are hardcoded in `.tf` files, not tfvars, as on production.
- **What uses each name today:**

  | Name | Today | This design adds |
  |---|---|---|
  | `<env>` | ALIAS → Vercel (`branch_domain`, `dns.tf`) | 3 Zoho MX records, Zoho SPF TXT |
  | `<token>._domainkey.<env>` | SES DKIM CNAMEs ×3 | nothing |
  | `zoho._domainkey.<env>` | nothing | Zoho DKIM TXT |
  | `mail.<env>` | SES MAIL FROM MX and SPF (#514; on stage after the next promotion) | nothing |
  | `_dmarc.<env>` | nothing (the apex's covers it) | nothing |

  SES never reads an MX or SPF record at `<env>`. Its envelope sender is `mail.<env>`, falling back to `amazonses.com`. `<env>` is an ALIAS, which resolves to A records rather than acting as a CNAME, so MX and TXT records can share the name. The apex in the same zone already has the same mix.

## Approaches

- **A. One alias per address, on each subdomain (chosen).** In the Zoho console, add `dev.` and `stage.` as domains with mail hosting on, plus four aliases of the owner's mailbox: `access@` and `no-reply@` on each. Terraform adds Zoho's MX, SPF and DKIM records, and the suppression list. Zoho documents every step, and it matches how the apex works. The cost is two console aliases per new address.
- **B. Subdomain stripping.** Zoho would deliver `x@<env>` to `x@ashutosh-pandey.com`, with no aliases per subdomain. Rejected: Zoho doesn't document whether stripping resolves to an alias, and `access@` and `no-reply@` on the apex are aliases. Replying as `access@<env>` would probably still need the alias, since Zoho sends only from addresses the mailbox owns.
- **C. SES inbound into S3, plus a forwarding Lambda.** Rejected: new code to maintain, and #403 already dropped it for production.

## The design

### Zoho console (manual, the owner or Claude in Chrome)

For each of `dev.ashutosh-pandey.com` and `stage.ashutosh-pandey.com`:

1. Domains → +Add → enter the subdomain → turn **Mail Hosting Status** on.
2. Email Configuration → DKIM: add selector **`zoho`** with a **2048-bit** key, the same as the apex. Copy the TXT value as one unbroken string.
3. Read the MX hosts and the SPF include the console shows for the subdomain. Expected: `mx.zoho.in` 10, `mx2.zoho.in` 20, `mx3.zoho.in` 50, and `include:zoho.in`. Use the console's values if they differ.
4. Users → the owner → Mailbox Settings → Email Alias: add `access` and `no-reply` on the subdomain.

After the records are live, verify each subdomain's MX, SPF and DKIM in the console.

### Terraform: `infra/modules/nonprod-account/email.tf`

- `vercel_dns_record.zoho_mx`: `for_each` over a priority-to-host map, `name = var.env`, `type = "MX"`. Same shape as production's `zoho_mx`.
- `vercel_dns_record.zoho_spf`: `name = var.env`, `type = "TXT"`, `value = "v=spf1 include:zoho.in -all"`. `-all` from the start, because the apex already showed `spf=pass` with this include (#403, #508). Zoho is the only sender that uses `<env>` as its envelope domain.
- `vercel_dns_record.zoho_dkim`: `name = "zoho._domainkey.${var.env}"`, `type = "TXT"`, `value = var.zoho_dkim_key`.
- `aws_sesv2_account_suppression_attributes`: `suppressed_reasons = ["BOUNCE", "COMPLAINT"]`, as on production. It matches what is already set, so the apply changes nothing live.
- Rewrite the file's header comment. Zoho now receives `<env>` mail and can send as it, and `no-reply@` and `access@` are Zoho aliases. The account stays in the SES sandbox.

### Terraform: inputs

- A new required variable `zoho_dkim_key` (string) in `infra/modules/nonprod-account/variables.tf`. The key differs per subdomain.
- `infra/dev/account/main.tf` and `infra/stage/account/main.tf` each pass their console value.

### Docs

- `docs/runbooks/nonprod-email-testing.md`:
  - Replace "Replies to `access@<env>` bounce" with where replies land.
  - Add that a test address which bounces is now suppressed, and how to remove it (`aws sesv2 delete-suppressed-destination`).
- `.claude/rules/infra.md`: extend the Zoho bullet. `<env>`'s MX, SPF and `zoho._domainkey.<env>` belong to Zoho too, in `infra/modules/nonprod-account/email.tf`, under the same rules: no second MX or `v=spf1` at that name.
- `ARCHITECTURE.md` says nothing about dev's and stage's email today and needs no change.
- `CHANGELOG.md`, `[Unreleased]`.

### Verification

- **Plan:** `dev/account` adds 3 MX, 1 SPF TXT, 1 DKIM TXT and 1 suppression attributes resource, and nothing else. No other stack changes.
- **DNS:** after the merge, `nslookup -type=MX dev.ashutosh-pandey.com` returns the three Zoho hosts. TXT returns exactly one `v=spf1`. `zoho._domainkey.dev` returns the key.
- **Zoho console:** shows MX, SPF and DKIM verified for `dev.`.
- **Mail:**
  - From an outside account, mail to `access@dev.` and `no-reply@dev.` lands in the owner's inbox.
  - A reply from Zoho as `access@dev.` shows `spf=pass`, `dkim=pass` and `dmarc=pass` in the received headers.
- **SES:** `aws sesv2 get-account --profile personal-dev-ro --region us-east-1` shows `SuppressionAttributes` with both reasons.
- Repeat for stage after the promotion.

## Rollout

1. Zoho console steps for both subdomains, before the PR, so the PR carries both DKIM keys and Zoho accepts mail the moment the MX records publish.
2. One PR into `dev` with the Terraform and docs changes, closing #542. Dev's records apply on merge, followed by dev's verification.
3. Stage's records apply at the next `dev → stage` promotion, followed by stage's verification.

## Left to the builder

- **If Zoho asks for an ownership record anyway**, add a per-environment verification TXT at `<env>` (an optional `zoho_verification` input), or a CNAME `zb<digits>.<env>` → `zmverify.zoho.in`. Either needs no other change to this design.
- **If the console shows MX hosts or an SPF include other than the expected ones**, use the console's values.
- Resource names, comment wording and how the docs changes are split across commits.

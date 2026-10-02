# Access control, part 3: domain email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mail to `access@ashutosh-pandey.com` reaches the owner's Gmail with `Reply-To` set to the sender, and the Access page emails invitees from that address when they're approved, granted, or lose access.

**Architecture:** An apex MX record points the domain at SES inbound in `us-east-1`. One receipt rule for `access@` stores the message in main's data bucket under `inbound-mail/` and invokes a small Python Lambda, `mail_forwarder`, which rewrites the headers and resends the message to the owner. The Access API's change routes send transactional mail through SESv2 `SendEmail`; a failed send doesn't undo the change and is reported on the page.

**Tech Stack:** SES (receiving and SESv2 sending), S3, Lambda (Python 3.12, zip via `hashicorp/archive`), pytest, `@aws-sdk/client-sesv2`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-access-control-design.md` (§7, §8 `email.tf`, §11 PR 3, §12). Depends on parts 1 and 2 (`2026-09-29-access-control-authorization.md`, `2026-09-29-access-control-grants.md`) being merged into `dev`.

## Global Constraints

- Everything in parts 1 and 2's Global Constraints still holds.
- Two PRs into `dev`, in order, each squash-merged after the `merging-a-pr` skill: `feat/access-control-email-infra` (Tasks 1–2, the forwarder and the Terraform; `Refs #300`) from `dev` after part 2 merged, then `feat/access-control-email` (Tasks 4–6; `Closes #300`) from `dev` after the first merged and CI's apply on `dev` finished. Same reason as parts 1 and 2: the code that reads `ACCESS_FROM_EMAIL` ships after the apply that creates it.
- Main's data bucket belongs to `infra/envs/main` (through `infra/modules/environment`). `shared` refers to it by name, `local.data_bucket_names["main"]`, and by ARN, `local.resume_bucket_arn` (the same bucket), and never reads the env stack's state.
- Addresses: receiving and sending `access@ashutosh-pandey.com`; forwards go to `var.alert_email`. Forward `From:` is `Access request <access@ashutosh-pandey.com>`; site mail `From:` is `Access <access@ashutosh-pandey.com>`, `Reply-To` the same.
- Forwarded subject prefix: `[access] `.
- `inbound-mail/` objects expire after 30 days.
- The receipt rule set is account-wide: only one can be active per region. It is named `site-inbound`; there is none today.
- `lambda/src/mail_forwarder/` sits under `lambda/`, so a push that touches it makes `deploy.yml`'s `changes` job rebuild the looper's container image. That rebuild is harmless (same image) and is accepted. The forwarder itself deploys only through Terraform, applied by CI with `shared`.
- `lambda/.venv` has no boto3 (the Lambda runtime provides it), so the forwarder imports boto3 only inside `handler()` when no client is passed in, and its logic is a pure function the tests call directly.

## Review Focus

1. **A sender with a display name and a comma**, e.g. `"Doe, Jane" <jane@example.com>`. `Reply-To` must be that exact address, built with `email.utils`, not string concatenation. Test in Task 1.
2. **A message that already has `Reply-To`**, e.g. from a mailing list. The forward replaces it with the original `From`, rather than sending two `Reply-To` headers. Test in Task 1.
3. **SES marks the message as spam or a virus.** The forwarder drops it and never fetches it from S3. Test in Task 1.
4. **SES is still in the sandbox when a grant is made.** The change is saved and the response carries `emailError` naming the SES error, which the page shows. Test in Task 4.
5. **An invitee with no email attribute.** No send is attempted; `emailError` says the address is missing. Test in Task 4.

---

### Task 1: `mail_forwarder`

**Files:**
- Create: `lambda/src/mail_forwarder/__init__.py` (empty), `lambda/src/mail_forwarder/handler.py`
- Test: `lambda/tests/test_mail_forwarder.py`

**Interfaces:**
- Produces: `rewrite(raw: bytes, *, forward_to: str, from_address: str) -> bytes`; `handler(event: dict, context: object, s3=None, ses=None) -> dict` returning `{"forwarded": bool, "reason"?: str}`. Environment: `BUCKET`, `PREFIX` (`inbound-mail/`), `FORWARD_TO`, `FROM_ADDRESS`.

- [ ] **Step 1: Branch**

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/access-control-email-infra
```

- [ ] **Step 2: Write the failing tests**

`lambda/tests/test_mail_forwarder.py`:

```python
from email import message_from_bytes, policy

from mail_forwarder.handler import handler, rewrite

RAW = (
    b'From: "Doe, Jane" <jane@example.com>\r\n'
    b"To: access@ashutosh-pandey.com\r\n"
    b"Cc: someone-else@example.com\r\n"
    b"Reply-To: list@example.org\r\n"
    b"Subject: Could I try the assistant?\r\n"
    b"Message-ID: <abc@example.com>\r\n"
    b"Return-Path: <bounce@example.com>\r\n"
    b"Sender: jane@example.com\r\n"
    b"DKIM-Signature: v=1; a=rsa-sha256; d=example.com; b=xyz\r\n"
    b"Content-Type: text/plain; charset=utf-8\r\n"
    b"\r\n"
    b"Hello, I'm Jane.\r\n"
)


def parsed(raw: bytes):
    return message_from_bytes(raw, policy=policy.default)


def test_rewrite_sets_from_to_and_reply_to():
    out = parsed(rewrite(RAW, forward_to="owner@example.com", from_address="access@ashutosh-pandey.com"))
    assert out["From"] == "Access request <access@ashutosh-pandey.com>"
    assert out["To"] == "owner@example.com"
    # The display name has a comma, so it must stay quoted.
    assert out["Reply-To"] == '"Doe, Jane" <jane@example.com>'
    assert out.get_all("Reply-To") == ['"Doe, Jane" <jane@example.com>']


def test_rewrite_prefixes_the_subject_once():
    out = parsed(rewrite(RAW, forward_to="o@x", from_address="access@ashutosh-pandey.com"))
    assert out["Subject"] == "[access] Could I try the assistant?"


def test_rewrite_removes_headers_ses_rejects_on_resend():
    out = parsed(rewrite(RAW, forward_to="o@x", from_address="access@ashutosh-pandey.com"))
    for header in ("Return-Path", "Sender", "Message-ID", "DKIM-Signature"):
        assert out[header] is None


def test_rewrite_sends_only_to_the_owner():
    # A kept Cc would resend the forward to the original sender's other recipients.
    out = parsed(rewrite(RAW, forward_to="o@x", from_address="access@ashutosh-pandey.com"))
    assert out["Cc"] is None
    assert out.get_all("To") == ["o@x"]


def test_rewrite_keeps_the_body():
    out = parsed(rewrite(RAW, forward_to="o@x", from_address="access@ashutosh-pandey.com"))
    assert out.get_content().strip() == "Hello, I'm Jane."


def test_rewrite_handles_a_message_without_a_subject():
    raw = b"From: a@example.com\r\nTo: access@ashutosh-pandey.com\r\n\r\nhi\r\n"
    out = parsed(rewrite(raw, forward_to="o@x", from_address="access@ashutosh-pandey.com"))
    assert out["Subject"] == "[access] (no subject)"


class FakeS3:
    def __init__(self, body: bytes):
        self.body = body
        self.calls = []

    def get_object(self, Bucket, Key):
        self.calls.append((Bucket, Key))

        class Body:
            def read(_self):
                return self.body

        return {"Body": Body()}


class FakeSes:
    def __init__(self):
        self.sent = []

    def send_raw_email(self, **kwargs):
        self.sent.append(kwargs)
        return {"MessageId": "m1"}


def event(spam="PASS", virus="PASS"):
    return {
        "Records": [
            {
                "ses": {
                    "mail": {"messageId": "msg-1"},
                    "receipt": {"spamVerdict": {"status": spam}, "virusVerdict": {"status": virus}},
                }
            }
        ]
    }


def test_handler_reads_the_stored_message_and_forwards_it(monkeypatch):
    monkeypatch.setenv("BUCKET", "bucket")
    monkeypatch.setenv("PREFIX", "inbound-mail/")
    monkeypatch.setenv("FORWARD_TO", "owner@example.com")
    monkeypatch.setenv("FROM_ADDRESS", "access@ashutosh-pandey.com")
    s3, ses = FakeS3(RAW), FakeSes()

    assert handler(event(), None, s3=s3, ses=ses) == {"forwarded": True}
    assert s3.calls == [("bucket", "inbound-mail/msg-1")]
    sent = ses.sent[0]
    assert sent["Source"] == "access@ashutosh-pandey.com"
    assert sent["Destinations"] == ["owner@example.com"]
    assert parsed(sent["RawMessage"]["Data"])["Reply-To"] == '"Doe, Jane" <jane@example.com>'


def test_handler_drops_spam_and_viruses_without_reading_them(monkeypatch):
    for key in ("BUCKET", "PREFIX", "FORWARD_TO", "FROM_ADDRESS"):
        monkeypatch.setenv(key, "x")
    for spam, virus in (("FAIL", "PASS"), ("PASS", "FAIL")):
        s3, ses = FakeS3(RAW), FakeSes()
        assert handler(event(spam, virus), None, s3=s3, ses=ses) == {"forwarded": False, "reason": "spam or virus"}
        assert s3.calls == [] and ses.sent == []
```

- [ ] **Step 3: Run to see them fail**

Run: `cd lambda && .venv/Scripts/python -m pytest -q tests/test_mail_forwarder.py`
Expected: FAIL, `ModuleNotFoundError: mail_forwarder`.

- [ ] **Step 4: Implement**

`lambda/src/mail_forwarder/__init__.py`: empty file.

`lambda/src/mail_forwarder/handler.py`:

```python
"""Forwards mail sent to access@ashutosh-pandey.com to the owner.

SES receiving stores the raw message in S3 and then invokes this. SES only
sends from verified addresses, and the original sender's DMARC would fail on a
straight forward, so the message goes out From the access address with the
sender in Reply-To: pressing Reply in Gmail answers them directly.
"""

import os
from email import message_from_bytes, policy
from email.utils import formataddr, parseaddr

# Headers SES refuses, or that would be wrong, on a resent message.
DROP = ("Return-Path", "Sender", "Message-ID", "DKIM-Signature", "From", "To", "Cc", "Reply-To", "Subject")


def rewrite(raw: bytes, *, forward_to: str, from_address: str) -> bytes:
    message = message_from_bytes(raw, policy=policy.SMTP)
    name, address = parseaddr(str(message.get("From", "")))
    subject = str(message.get("Subject") or "(no subject)")
    for header in DROP:
        del message[header]
    message["From"] = formataddr(("Access request", from_address))
    message["To"] = forward_to
    if address:
        message["Reply-To"] = formataddr((name, address))
    message["Subject"] = f"[access] {subject}"
    return message.as_bytes()


def handler(event, context, s3=None, ses=None):
    record = event["Records"][0]["ses"]
    receipt = record["receipt"]
    if receipt["spamVerdict"]["status"] == "FAIL" or receipt["virusVerdict"]["status"] == "FAIL":
        return {"forwarded": False, "reason": "spam or virus"}

    if s3 is None or ses is None:
        import boto3  # provided by the Lambda runtime; not installed in lambda/.venv

        s3 = s3 or boto3.client("s3")
        ses = ses or boto3.client("ses")

    key = os.environ["PREFIX"] + record["mail"]["messageId"]
    raw = s3.get_object(Bucket=os.environ["BUCKET"], Key=key)["Body"].read()
    forwarded = rewrite(raw, forward_to=os.environ["FORWARD_TO"], from_address=os.environ["FROM_ADDRESS"])
    ses.send_raw_email(
        Source=os.environ["FROM_ADDRESS"],
        Destinations=[os.environ["FORWARD_TO"]],
        RawMessage={"Data": forwarded},
    )
    return {"forwarded": True}
```

- [ ] **Step 5: Run the tests**

Run: `cd lambda && .venv/Scripts/python -m pytest -q`
Expected: the new tests PASS and the looper's tests still pass. If `test_rewrite_sets_from_to_and_reply_to` shows the quoted name differently (e.g. `Doe, Jane <…>` without quotes), the header was set as a string the `policy.default` parser re-folded; compare with `parseaddr(out["Reply-To"]) == ("Doe, Jane", "jane@example.com")` instead of the literal, since that is the property that matters.

- [ ] **Step 6: Commit**

```bash
cd /e/Personal/looper
git add lambda/src/mail_forwarder lambda/tests/test_mail_forwarder.py
git commit -m "feat(mail): forward access@ mail to the owner with Reply-To set (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: Terraform — receiving, the forwarder, sending permission

**Files:**
- Modify: `infra/shared/backend.tf`, `infra/shared/.terraform.lock.hcl`, `infra/shared/email.tf`, `infra/shared/access.tf` (Vercel send permission and env var), `infra/modules/environment/main.tf` (lifecycle rule)

**Interfaces:**
- Consumes: `lambda/src/mail_forwarder/` (Task 1); `local.data_bucket_names["main"]` and `local.resume_bucket_arn` (main's data bucket), `aws_sesv2_email_identity.domain`, `aws_sesv2_email_identity.owner`, `var.alert_email`.
- Produces: MX record; active receipt rule set `site-inbound`; Lambda `${var.project_name}-mail-forwarder`; Vercel env var `ACCESS_FROM_EMAIL`; the Vercel role may `ses:SendEmail` as `access@`.

- [ ] **Step 1: Add the archive provider**

In `infra/shared/backend.tf`'s `required_providers`, add:

```hcl
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
```

```bash
cd /e/Personal/looper/infra/shared && AWS_PROFILE=personal terraform init
terraform providers lock -platform=linux_amd64 -platform=windows_amd64
```

Expected: `hashicorp/archive` installed; `.terraform.lock.hcl` gains its entry, with hashes for CI's platform (`linux_amd64`) as well as the workstation's. Not `init -upgrade`, which would also move the other providers. Commit the lock file with this task.

- [ ] **Step 2: Expire stored mail after 30 days**

In `infra/modules/environment/main.tf`'s `aws_s3_bucket_lifecycle_configuration.data`, after the `expire-resume-archive` rule, add (S3 allows one lifecycle configuration per bucket and the module owns it, so the rule can't live in `shared` with the rest):

```hcl
  # Only main's bucket receives mail (infra/shared/email.tf), but the rule is
  # harmless on dev and stage.
  rule {
    id     = "expire-inbound-mail"
    status = "Enabled"
    filter { prefix = "inbound-mail/" }
    expiration { days = 30 }
  }
```

- [ ] **Step 3: Add receiving and the forwarder to `email.tf`**

Replace the header comment of `infra/shared/email.tf` (its first four lines) with:

```hcl
# SES for ashutosh-pandey.com. Sending: Cognito sign-in codes (spec
# 2026-09-28-cognito-login-design.md), the News Desk digest (spec
# 2026-09-28-news-digest-design.md) and access emails to invited users (spec
# 2026-09-29-access-control-design.md §7), which needs SES production access.
# Receiving: access@ only, forwarded to the owner by mail_forwarder.
```

Append:

```hcl
# --- Receiving: access@ → S3 → mail_forwarder → the owner ---

resource "vercel_dns_record" "mx" {
  team_id     = local.vercel_team_id
  domain      = vercel_project_domain.custom.domain
  name        = ""
  type        = "MX"
  value       = "inbound-smtp.${var.aws_region}.amazonaws.com"
  mx_priority = 10
  ttl         = 1800
}

locals {
  inbound_prefix = "inbound-mail/"
  access_address = "access@${vercel_project_domain.custom.domain}"
}

# SES checks at rule creation that it can write here, so the rule depends on this.
# The bucket is main's, created by infra/envs/main; this is its only bucket policy,
# so nothing else manages it. If the module ever adds one, merge this statement into it.
resource "aws_s3_bucket_policy" "inbound_mail" {
  bucket = local.data_bucket_names["main"]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "SesStoresInboundMail"
        Effect    = "Allow"
        Principal = { Service = "ses.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${local.resume_bucket_arn}/${local.inbound_prefix}*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        }
      },
    ]
  })
}

data "archive_file" "mail_forwarder" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/src/mail_forwarder"
  output_path = "${path.module}/.build/mail_forwarder.zip"
  excludes    = ["__pycache__"]
}

resource "aws_iam_role" "mail_forwarder" {
  name = "${var.project_name}-mail-forwarder"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "mail_forwarder_logs" {
  role       = aws_iam_role.mail_forwarder.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "mail_forwarder" {
  name = "${var.project_name}-mail-forwarder"
  role = aws_iam_role.mail_forwarder.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${local.resume_bucket_arn}/${local.inbound_prefix}*"
      },
      {
        # Both identities: in the sandbox SES checks the recipient as well as the sender.
        Effect   = "Allow"
        Action   = "ses:SendRawEmail"
        Resource = [aws_sesv2_email_identity.domain.arn, aws_sesv2_email_identity.owner.arn]
      },
    ]
  })
}

resource "aws_lambda_function" "mail_forwarder" {
  function_name    = "${var.project_name}-mail-forwarder"
  role             = aws_iam_role.mail_forwarder.arn
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.mail_forwarder.output_path
  source_code_hash = data.archive_file.mail_forwarder.output_base64sha256
  timeout          = 30
  memory_size      = 128

  environment {
    variables = {
      BUCKET       = local.data_bucket_names["main"]
      PREFIX       = local.inbound_prefix
      FORWARD_TO   = var.alert_email
      FROM_ADDRESS = local.access_address
    }
  }
}

resource "aws_lambda_permission" "ses_invokes_forwarder" {
  statement_id   = "AllowSesInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.mail_forwarder.function_name
  principal      = "ses.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}

# Only one rule set can be active per account and region; this is the only one.
resource "aws_ses_receipt_rule_set" "site" {
  rule_set_name = "site-inbound"
}

resource "aws_ses_active_receipt_rule_set" "site" {
  rule_set_name = aws_ses_receipt_rule_set.site.rule_set_name
}

resource "aws_ses_receipt_rule" "access" {
  name          = "access"
  rule_set_name = aws_ses_receipt_rule_set.site.rule_set_name
  recipients    = [local.access_address]
  enabled       = true
  scan_enabled  = true

  s3_action {
    bucket_name       = local.data_bucket_names["main"]
    object_key_prefix = local.inbound_prefix
    position          = 1
  }

  lambda_action {
    function_arn    = aws_lambda_function.mail_forwarder.arn
    invocation_type = "Event"
    position        = 2
  }

  depends_on = [aws_s3_bucket_policy.inbound_mail, aws_lambda_permission.ses_invokes_forwarder]
}

# Production senders are expected to stop mailing addresses that bounce or complain.
resource "aws_sesv2_account_suppression_attributes" "site" {
  suppressed_reasons = ["BOUNCE", "COMPLAINT"]
}
```

Add `infra/shared/.build/` to the repo's `.gitignore` (the zip is rebuilt on every plan, in CI too).

- [ ] **Step 4: Let the app send as `access@`**

In `infra/shared/access.tf`, add a statement to `local.vercel_access_statements` (both Vercel roles):

```hcl
      {
        # The owner's identity too: in the sandbox SES also checks the recipient,
        # so the owner can test these emails before production access arrives.
        Sid      = "SendAccessEmail"
        Effect   = "Allow"
        Action   = ["ses:SendEmail"]
        Resource = [aws_sesv2_email_identity.domain.arn, aws_sesv2_email_identity.owner.arn]
        Condition = {
          StringEquals = { "ses:FromAddress" = local.access_address }
        }
      },
```

and append:

```hcl
resource "vercel_project_environment_variable" "access_from_email" {
  project_id = vercel_project.looper.id
  key        = "ACCESS_FROM_EMAIL"
  value      = local.access_address
  target     = local.env_targets
  sensitive  = false
}
```

Until production access (Task 3) is granted, sends to anyone but the owner fail with `MessageRejected`, which the page reports. Don't add other recipients' identities to the IAM resource to work around it.

- [ ] **Step 5: Format, commit, PR**

```bash
cd /e/Personal/looper/infra/shared && terraform fmt && terraform validate
cd ../modules/environment && terraform fmt
cd /e/Personal/looper
git add infra/shared/backend.tf infra/shared/.terraform.lock.hcl infra/shared/email.tf infra/shared/access.tf infra/modules/environment/main.tf .gitignore
git commit -m "feat(infra): receive access@ mail and let the site send from it (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/access-control-email-infra
gh pr create --base dev --title "feat(infra): receive access@ mail and let the site send from it (#300)" --body "$(cat <<'EOF'
Part 3a of #300 (plan: docs/superpowers/plans/2026-09-29-access-control-email.md, Tasks 1-2).

- Apex MX to SES inbound; receipt rule set site-inbound (made active) with one rule for access@
- The rule stores the message in main's data bucket under inbound-mail/ and invokes mail_forwarder, which resends it to the owner with Reply-To set to the sender
- mail_forwarder deploys as a zip through Terraform, not deploy.yml
- inbound-mail/ expires after 30 days (module lifecycle rule; reaches main's bucket when this is promoted to main)
- Account suppression list for bounces and complaints
- Both Vercel roles may ses:SendEmail as access@; ACCESS_FROM_EMAIL for production and preview

Refs #300
EOF
)"
```

The `Terraform` workflow posts a plan per stack. `shared`: about 12 to add, 2 to change (the two Vercel access policies), 0 to destroy. `envs/dev`: 1 to change (its lifecycle configuration). Stop on any destroy.

The `envs/stage` and `envs/main` lifecycle changes apply when this reaches those branches. Until it reaches `main`, mail stored in main's bucket doesn't expire.

- [ ] **Step 6: Merge, wait for the apply, check**

Invoke the `merging-a-pr` skill and merge. This PR touches `lambda/`, so it is a lambda-touching merge (one at a time). Then:

```bash
gh run list --workflow terraform.yml --branch dev --limit 1
gh run watch <id> --exit-status
aws ses describe-active-receipt-rule-set --profile personal --region us-east-1 --query 'Metadata.Name'
dig +short MX ashutosh-pandey.com
```

Expected: the run succeeds; `"site-inbound"`; `10 inbound-smtp.us-east-1.amazonaws.com.` (DNS can take a few minutes).

- [ ] **Step 7: Send a real email**

From any mailbox other than the owner's, send "test" to `access@ashutosh-pandey.com`. Within a minute the owner's inbox gets `[access] test` from `Access request <access@ashutosh-pandey.com>`, and Reply addresses the sender. If nothing arrives:

```bash
aws logs tail /aws/lambda/bgm-looper-mail-forwarder --since 10m --profile personal --region us-east-1
aws s3 ls s3://portfolio-data-223376380711/inbound-mail/ --profile personal --region us-east-1
```

An object in S3 but no log means the Lambda action didn't run (check the permission); a log with `MessageRejected` means an identity isn't verified.

---

### Task 3: Request SES production access (manual, the owner)

Step 1 was done on 2026-09-29 through the console form (Transactional, https://ashutosh-pandey.com, English), which has no use-case field. If AWS replies asking how the mail will be used, answer with the `--use-case-description` text below. The same day, #301 added a custom MAIL FROM (`mail.ashutosh-pandey.com`) and SPF records, so SES mail from the domain passes SPF, DKIM and DMARC. AWS granted production access on 2026-10-01 (`get-account` shows `production: true`, `HEALTHY` on 2026-10-02), so this task is done.

- [x] **Step 1: Submit the request**

```bash
aws sesv2 put-account-details --profile personal --region us-east-1 \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url https://ashutosh-pandey.com \
  --contact-language EN \
  --use-case-description "Transactional email for a personal website's private tools. When the site owner approves someone who asked for access, grants them a limited number of uses of a feature, or ends their access, the site sends that one person a short plain-text email from access@ashutosh-pandey.com. Recipients are only people who signed in and wrote to ask for access. Expected volume is under 50 emails a month. No marketing or bulk mail. Bounces and complaints are on the account-level suppression list, and the domain has DKIM and DMARC." \
  --additional-contact-email-addresses "$(grep alert_email infra/shared/terraform.tfvars | cut -d'"' -f2)"
```

- [x] **Step 2: Wait for AWS**

AWS replies by email, usually within a day. Check with:

```bash
aws sesv2 get-account --profile personal --region us-east-1 --query '{production:ProductionAccessEnabled,status:EnforcementStatus}'
```

`production: true` means invitees can receive mail. Tasks 4 and 5 don't wait for it: until then the page shows the sandbox error after each change.

---

### Task 4: Access emails

**Files:**
- Create: `web/lib/access-mail.ts`
- Test: `web/lib/access-mail.test.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: `AccessUser` (part 2, `lib/access-admin.ts`); `Grant` (part 2); `METERED_LABELS` (part 2, `lib/authz/my-grants.ts`); `awsCredentials()`.
- Produces: `sendApproved(user: AccessUser): Promise<string | null>`, `sendGrants(user: AccessUser, grants: Grant[]): Promise<string | null>`, `sendEnded(user: AccessUser, what: string): Promise<string | null>` — each returns `null` when sent, or the reason it wasn't.

- [ ] **Step 1: Branch and install**

Start from `dev` after Task 2's PR merged and its apply finished:

```bash
cd /e/Personal/looper && git switch dev && git pull && git switch -c feat/access-control-email
cd web && npm install @aws-sdk/client-sesv2
```

- [ ] **Step 2: Write the failing tests**

`web/lib/access-mail.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { sendApproved, sendEnded, sendGrants } from "./access-mail";

const ses = mockClient(SESv2Client);
const user = { sub: "u1", username: "Google_1", email: "jane@example.com", createdAt: "", groups: ["friends"] };

beforeEach(() => {
  ses.reset();
  process.env.ACCESS_FROM_EMAIL = "access@ashutosh-pandey.com";
  process.env.APP_AWS_REGION = "us-east-1";
});

describe("access emails", () => {
  it("sends the approval from and replying to the access address", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    expect(await sendApproved(user)).toBeNull();
    const input = ses.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.FromEmailAddress).toBe("Access <access@ashutosh-pandey.com>");
    expect(input.ReplyToAddresses).toEqual(["access@ashutosh-pandey.com"]);
    expect(input.Destination).toEqual({ ToAddresses: ["jane@example.com"] });
    expect(input.Content?.Simple?.Subject?.Data).toBe("You can now use the tools on ashutosh-pandey.com");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("BGM Looper, Money Planner and News Desk");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("https://ashutosh-pandey.com/tools");
  });

  it("lists every live grant, with uses left and the last day", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendGrants(user, [
      { sub: "u1", action: "newsdesk:ask", email: "", limit: 20, used: 0, expiresAt: 1_791_504_000, grantedAt: 0 },
      { sub: "u1", action: "looper:process", email: "", limit: 5, used: 2, expiresAt: 1_791_504_000, grantedAt: 0 },
    ]);
    const text = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content?.Simple?.Body?.Text?.Data;
    expect(text).toContain("News Desk ask: 20 uses, until 9 Oct 2026");
    expect(text).toContain("BGM Looper processing: 3 uses, until 9 Oct 2026");
  });

  it("says what ended", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendEnded(user, "News Desk ask");
    expect(ses.commandCalls(SendEmailCommand)[0].args[0].input.Content?.Simple?.Body?.Text?.Data).toContain(
      "Your access to News Desk ask on ashutosh-pandey.com has ended.",
    );
  });

  it("returns SES's error instead of throwing, e.g. in the sandbox", async () => {
    ses.on(SendEmailCommand).rejects(Object.assign(new Error("Email address is not verified."), { name: "MessageRejected" }));
    expect(await sendApproved(user)).toBe("MessageRejected: Email address is not verified.");
  });

  it("sends nothing to a user without an email address", async () => {
    expect(await sendApproved({ ...user, email: "" })).toBe("this account has no email address");
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it("sends nothing when ACCESS_FROM_EMAIL is not set", async () => {
    delete process.env.ACCESS_FROM_EMAIL;
    expect(await sendApproved(user)).toBe("ACCESS_FROM_EMAIL is not set");
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `cd web && npx vitest run lib/access-mail.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`web/lib/access-mail.ts`:

```ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { awsCredentials } from "./aws";
import type { AccessUser } from "./access-admin";
import type { Grant } from "./authz/grants";
import { METERED_LABELS } from "./authz/my-grants";

const SITE = "https://ashutosh-pandey.com";

let client: SESv2Client | null = null;
const ses = () => (client ??= new SESv2Client({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }));

const day = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Null when sent; otherwise why not. A failed email never undoes the change
 * that triggered it: the Access page shows the reason instead. */
async function send(to: string, subject: string, lines: string[]): Promise<string | null> {
  const from = process.env.ACCESS_FROM_EMAIL;
  if (!from) return "ACCESS_FROM_EMAIL is not set";
  if (!to) return "this account has no email address";
  const text = [...lines, "", "Reply to this email if you have a question."].join("\n");
  const html = text
    .split("\n\n")
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  try {
    await ses().send(
      new SendEmailCommand({
        FromEmailAddress: `Access <${from}>`,
        ReplyToAddresses: [from],
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: text }, Html: { Data: html } },
          },
        },
      }),
    );
    return null;
  } catch (err) {
    const e = err as Error;
    console.error("access: email failed", e);
    return `${e.name}: ${e.message}`;
  }
}

export function sendApproved(user: AccessUser): Promise<string | null> {
  return send(user.email, "You can now use the tools on ashutosh-pandey.com", [
    "You've been given access to BGM Looper, Money Planner and News Desk.",
    "",
    `Sign in at ${SITE}/tools with the same Google account.`,
    "",
    "Anything that costs money to run (the News Desk assistant and refresh, BGM Looper processing) needs a separate grant. Reply to ask for one.",
  ]);
}

export function sendGrants(user: AccessUser, grants: Grant[]): Promise<string | null> {
  const lines = grants.map((g) => `${METERED_LABELS[g.action]}: ${g.limit - g.used} uses, until ${day(g.expiresAt)}`);
  return send(user.email, "Your grants on ashutosh-pandey.com", [
    "You can now use:",
    "",
    ...lines,
    "",
    `Your remaining uses are shown at ${SITE}/tools.`,
  ]);
}

export function sendEnded(user: AccessUser, what: string): Promise<string | null> {
  return send(user.email, "Your access on ashutosh-pandey.com has ended", [
    `Your access to ${what} on ashutosh-pandey.com has ended.`,
  ]);
}
```

- [ ] **Step 5: Run and commit**

Run: `cd web && npx vitest run lib/access-mail.test.ts`
Expected: PASS.

```bash
git add web/lib/access-mail.ts web/lib/access-mail.test.ts web/package.json web/package-lock.json
git commit -m "feat(access): approval, grant and access-ended emails (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: The Access routes send the emails

**Files:**
- Modify: `web/app/api/access/members/route.ts`, `web/app/api/access/members/[sub]/route.ts`, `web/app/api/access/grants/route.ts`, `web/app/api/access/grants/[sub]/[action]/route.ts`
- Test: `web/app/api/access/routes.test.ts`

**Interfaces:**
- Consumes: Task 4's senders; `getGrantStore` (part 2).
- Produces: change responses `{ ok: true }` or `{ ok: true, emailError: string }`. The page (part 2, `AccessAdmin.tsx`) already shows `emailError`. Dismiss sends nothing.

- [ ] **Step 1: Write the failing tests**

In `web/app/api/access/routes.test.ts`, add mocks:

```ts
vi.mock("@/lib/access-mail", () => ({ sendApproved: vi.fn(), sendGrants: vi.fn(), sendEnded: vi.fn() }));
vi.mock("@/lib/authz/grants", () => ({ getGrantStore: vi.fn() }));
import { sendApproved, sendEnded, sendGrants } from "@/lib/access-mail";
import { getGrantStore } from "@/lib/authz/grants";
```

In `beforeEach`: `vi.mocked(sendApproved).mockResolvedValue(null); vi.mocked(sendGrants).mockResolvedValue(null); vi.mocked(sendEnded).mockResolvedValue(null); vi.mocked(getGrantStore).mockReturnValue({ list: vi.fn(async () => []) } as never);`

Add:

```ts
describe("/api/access emails", () => {
  it("approve emails the new member", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    expect(await (await approveRoute(json({ sub: "u1" }))).json()).toEqual({ ok: true });
    expect(sendApproved).toHaveBeenCalledWith(user);
  });

  it("reports a failed email without failing the change", async () => {
    vi.mocked(approve).mockResolvedValue(user);
    vi.mocked(sendApproved).mockResolvedValue("MessageRejected: Email address is not verified.");
    const res = await approveRoute(json({ sub: "u1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailError: "MessageRejected: Email address is not verified." });
  });

  it("grant emails every live grant the member now holds", async () => {
    const live = { action: "newsdesk:ask", limit: 20, used: 0, expiresAt: 9e9 };
    const spent = { action: "looper:process", limit: 5, used: 5, expiresAt: 9e9 };
    vi.mocked(grantAction).mockResolvedValue({ user, grant: live as never });
    vi.mocked(getGrantStore).mockReturnValue({ list: vi.fn(async () => [live, spent]) } as never);
    await grantRoute(json({ sub: "u1", action: "newsdesk:ask" }));
    expect(sendGrants).toHaveBeenCalledWith(user, [live]);
  });

  it("remove and revoke email what ended; dismiss sends nothing", async () => {
    vi.mocked(removeMember).mockResolvedValue(user);
    vi.mocked(revokeGrant).mockResolvedValue(user);
    vi.mocked(dismiss).mockResolvedValue(user);
    await removeRoute(new Request("http://x"), params({ sub: "u1" }));
    await revokeRoute(new Request("http://x"), params({ sub: "u1", action: "newsdesk:ask" }));
    await dismissRoute(new Request("http://x"), params({ sub: "u1" }));
    expect(sendEnded).toHaveBeenNthCalledWith(1, user, "the tools");
    expect(sendEnded).toHaveBeenNthCalledWith(2, user, "News Desk ask");
    expect(sendEnded).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd web && npx vitest run app/api/access`
Expected: the new block FAILS (nothing sent).

- [ ] **Step 3: Implement**

Add to `web/lib/access-api.ts`:

```ts
/** The change succeeded; say so, and pass on why the email didn't go, if it didn't. */
export function changed(emailError: string | null): Response {
  return NextResponse.json(emailError ? { ok: true, emailError } : { ok: true });
}
```

`web/app/api/access/members/route.ts` — in the `respond` callback, replace `return NextResponse.json({ ok: true });` with `return changed(await sendApproved(user));`, import `sendApproved` from `@/lib/access-mail` and `changed` from `@/lib/access-api`, and drop the unused `NextResponse` import.

`web/app/api/access/members/[sub]/route.ts` — replace the return with `return changed(await sendEnded(user, "the tools"));`, same import changes with `sendEnded`.

`web/app/api/access/grants/route.ts` — replace the return with:

```ts
    const now = Math.floor(Date.now() / 1000);
    const live = (await getGrantStore().list(user.sub)).filter((g) => g.used < g.limit && g.expiresAt > now);
    return changed(await sendGrants(user, live));
```

importing `getGrantStore` from `@/lib/authz/grants` and `sendGrants` from `@/lib/access-mail`. (Reading the list after the put includes the new grant.)

`web/app/api/access/grants/[sub]/[action]/route.ts` — replace the return with `return changed(await sendEnded(user, METERED_LABELS[parsed.data]));`, importing `METERED_LABELS` from `@/lib/authz/my-grants` and `sendEnded`.

Leave `pending/[sub]/route.ts` as it is.

- [ ] **Step 4: Run and commit**

Run: `cd web && npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS.

```bash
git add web/lib/access-api.ts web/app/api/access
git commit -m "feat(access): email invitees when their access changes (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: Docs, CHANGELOG, PR, final checks

**Files:**
- Modify: `.claude/rules/infra.md`, `ARCHITECTURE.md`, `CHANGELOG.md`

- [ ] **Step 1: Docs**

- `.claude/rules/infra.md`, new bullet: "**SES receiving is account-wide.** `email.tf` makes `site-inbound` the active receipt rule set in `us-east-1`; AWS allows one per region, so any other inbound mail setup in this account has to join this set. The apex MX record sends all mail for the domain to SES, and only `access@` has a rule. `mail_forwarder` (`lambda/src/mail_forwarder/`) deploys through Terraform as a zip (`hashicorp/archive`, built into the gitignored `infra/shared/.build/`) when CI applies `shared`, not through `deploy.yml`; a change there still makes `deploy.yml` rebuild the looper image, which is harmless. Stored messages expire from `inbound-mail/` after 30 days. When a forward doesn't arrive: an object under `inbound-mail/` with no Lambda log means the invoke permission; a `MessageRejected` log means an identity isn't verified."
- `.claude/rules/infra.md`, second new bullet: "**The apex publishes `v=spf1 -all`** (`email.tf`, #301): nothing may send with the bare domain as its envelope sender. SES uses the custom MAIL FROM `mail.ashutosh-pandey.com`, whose own TXT record includes `amazonses.com`. A new mail service that sends as the domain (a newsletter's custom domain, a mailbox provider) has to be added to the apex SPF record first, or its mail fails SPF."
- `ARCHITECTURE.md`: add to the cost/services section: "SES receiving for `access@` (S3 + a 128 MB Python Lambda) and SESv2 sending for access emails: about $0.10 per 1,000 messages each way."

- [ ] **Step 2: CHANGELOG**

Under `[Unreleased]` → `### Added`:

```markdown
- Email for access requests: mail to access@ashutosh-pandey.com reaches the owner with Reply-To set to the sender, and people get an email from that address when they're approved, given a grant, or lose access. Sending to people other than the owner needs SES production access (#300).
```

- [ ] **Step 3: Verify everything**

```bash
cd /e/Personal/looper/lambda && .venv/Scripts/python -m pytest -q
cd ../web && npm test && npm run lint && npx tsc --noEmit
KEYSTATIC_GITHUB_CLIENT_ID=dummy KEYSTATIC_GITHUB_CLIENT_SECRET=dummy KEYSTATIC_SECRET=dummy npm run build && npm run test:e2e
```

Expected: all green.

- [ ] **Step 4: Commit, push, PR**

```bash
cd /e/Personal/looper
git add .claude/rules/infra.md ARCHITECTURE.md CHANGELOG.md
git commit -m "docs: access email (#300)" -m "Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
git push -u origin feat/access-control-email
gh pr create --base dev --title "feat: access@ email in and out (#300)" --body "$(cat <<'EOF'
Part 3b of #300 (plan: docs/superpowers/plans/2026-09-29-access-control-email.md).

- Uses the receiving path and send permission applied by the infra PR (Tasks 1-2)
- The Access page emails invitees on approve, grant, remove and revoke; a failed send is reported and doesn't undo the change
- SES production access requested on <date>; status: <pending/granted>

Closes #300
EOF
)"
```

Then invoke the `merging-a-pr` skill and follow it to merge.

- [ ] **Step 5: Manual check on `dev`, after production access is granted**

1. From a second account, email `access@ashutosh-pandey.com` → it reaches the owner's Gmail as `[access] …`; Reply goes to that account.
2. Approve the account on the Access page → it receives "You can now use the tools on ashutosh-pandey.com".
3. Grant News Desk ask, 2 uses → it receives "Your grants on ashutosh-pandey.com" listing "News Desk ask: 2 uses, until …".
4. Revoke it → "Your access on ashutosh-pandey.com has ended".
5. Reply to any of these from the second account → the reply reaches the owner as `[access] Re: …`.

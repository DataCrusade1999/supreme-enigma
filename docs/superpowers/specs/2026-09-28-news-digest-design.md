# News Desk daily digest — Design

**Date:** 2026-09-28
**Status:** Approved 2026-09-28. Written without a brainstorming session, at the owner's request; the owner reviewed the §3 decisions afterwards.
**Issue:** #289
**Epic:** #285 (phase 4 of 5). Independent of phases 1–3. Phase 5 depends on its SES domain identity.

## 1. Problem

The epic's phase 4 is about learning SES and EventBridge Scheduler. The looper is the wrong place for email: the owner is the only user, and the page already shows the result. The News Desk is a better fit. Headlines only update when the owner presses Refresh, so a daily email of what's new is something the owner would actually read.

This reverses two non-goals in the News Desk spec (`2026-09-25-news-desk-design.md` §2): "Refresh happens only when the owner clicks Refresh" and "Any scheduled job, email digest or notification". The owner asked for scheduling and email in this epic, and that takes precedence.

## 2. Goals and non-goals

Goals:

- **Daily digest.** At 07:30 IST, production refreshes the News Desk and emails the owner the headlines that are new since the previous snapshot, grouped by topic, from `digest@ashutosh-pandey.com`.
- **SES domain identity.** `ashutosh-pandey.com` becomes an SES identity with Easy DKIM, and its DNS records (DKIM CNAMEs, DMARC TXT) are managed in Terraform through Vercel DNS.
- **Scheduler to Vercel path.** EventBridge Scheduler puts an event on a custom event bus, and a rule sends it to an EventBridge API destination: an HTTPS call to a Vercel route, authenticated with an API-key header.
- **Manual trigger.** Dev and stage can be triggered by hand with `aws events put-events`, to test without waiting for the schedule.

Non-goals:

- **Leaving the SES sandbox.** The only recipient is the owner, whose address becomes a verified identity, so sandbox limits (200 emails a day, verified recipients only) are enough.
- **Subscribers, unsubscribe links, bounce handling.** Buttondown stays the newsletter.
- **Digests for the looper or for indicators.** Headlines only.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Who runs the refresh | The existing Next.js `runRefresh` on Vercel | The feeds, tagging and MoSPI code are in TypeScript. Moving them to a Lambda would duplicate them. |
| How AWS reaches Vercel | Scheduler → custom bus `looper` → rule → API destination with a connection (API key) | Scheduler targets only AWS APIs, not HTTP. An API destination is the AWS-native HTTP target. The secret it holds in Secrets Manager is included in the API-destination price. |
| The 5-second limit | The route checks the token, schedules the work with Next's `after()`, and answers `202` at once | API destinations time out after 5 s and retry on timeouts. A refresh takes up to about 60 s. `after()` runs the work within the route's `maxDuration`. |
| Route location | `POST /api/digest/news-desk`, outside the gated `/api/news-desk/*` prefix | The gate is a session cookie, and EventBridge has none. The route does its own check: an `x-digest-token` header compared in constant time against `DIGEST_TOKEN`. |
| Empty digest | Nothing new means no email, just a log line | An empty daily email trains the owner to ignore it. |
| Schedule scope | One schedule, for production only, starting `DISABLED` | Dev and stage are triggered by hand. The schedule is enabled only once the route is on production, so the first runs can't hit a 404. |
| Token | `random_password.digest_token`, shared by all envs, like `COOKIE_SECRET` | Nothing to type into tfvars, and nothing new to rotate by hand. |

## 4. Email

- From: `News Desk <digest@ashutosh-pandey.com>`. To: `var.alert_email`.
- Subject: `News Desk: <n> new headline(s)`.
- Body:
  - Sections in the order Economy, Reforms, Legislation, then Untagged, each with its headlines as `title — source` plus a link.
  - `Drop`-tagged items are left out.
  - A plain-text and an HTML version, with titles HTML-escaped.
  - A last line linking to `https://ashutosh-pandey.com/tools/news-desk`.
- "New" means headline ids in the new snapshot that were not in the previous one. If the previous snapshot is missing or corrupt, everything counts as new. That can only happen on the first run, and it's capped by the News Desk's 14-day window.

## 5. Infrastructure

SES and DNS:
- `aws_sesv2_email_identity.domain`: `ashutosh-pandey.com`, Easy DKIM with RSA 2048.
- `vercel_dns_record` × 3: CNAME records `<token>._domainkey` → `<token>.dkim.amazonses.com`. Uses `count = 3`, because the tokens aren't known until apply.
- `vercel_dns_record`: TXT `_dmarc` = `v=DMARC1; p=none;`. No `rua` address, which would publish the owner's email in DNS.
- `aws_sesv2_email_identity.owner` for `var.alert_email`. SES sends a verification link that the owner has to click once.

EventBridge:
- `aws_cloudwatch_event_bus.looper`.
- `aws_cloudwatch_event_connection.news_digest` with `API_KEY` auth: header `x-digest-token`, value the token.
- `aws_cloudwatch_event_api_destination.news_digest` per env. `POST https://<host>/api/digest/news-desk`, where host is the apex for main and `dev.`/`stage.` for the others. Rate limit 1/s.
- `aws_cloudwatch_event_rule.news_digest` per env on the `looper` bus. Pattern: `source = looper.scheduler`, `detail-type = NewsDigestRequested`, `detail.env = <env>`.
- A target per rule: the API destination, body `{}`, retry policy of 2 attempts within 1 hour.
- `aws_scheduler_schedule.news_digest`:
  - `cron(30 7 * * ? *)` in `Asia/Kolkata`, flexible window off
  - target: the bus, via the templated PutEvents target, with detail `{"env":"main"}`
  - `state = "DISABLED"` at first
- IAM: a scheduler role (`events:PutEvents` on the bus) and an EventBridge role (`events:InvokeApiDestination` on the three destinations).
- An alarm on `AWS/Events` `FailedInvocations` for main's rule, to the existing SNS topic.

Vercel:
- The `vercel` role gets `ses:SendEmail` on both identities.
- New env vars for production and preview: `DIGEST_TOKEN` (sensitive), `DIGEST_FROM`, `DIGEST_TO`.

## 6. Web

- `lib/aws.ts`: `getSesClient()`.
- `lib/email.ts`: `sendEmail({ from, to, subject, text, html })` with `SendEmailCommand` (SES v2).
- `lib/news-desk/digest.ts`:
  - pure `newHeadlines(previous, current)` and `renderDigest(items, siteUrl)`
  - `sendNewsDigest()`, which reads the previous snapshot (treating a corrupt one as absent), runs `runRefresh()`, and sends if there's anything new
- `app/api/digest/news-desk/route.ts`:
  - `503` unless all digest env vars and `S3_BUCKET_NAME` are set
  - `401` on a missing or wrong token
  - otherwise `after(sendNewsDigest)` and `202`
  - `maxDuration = 60`

## 7. Testing

- **Vitest:**
  - `newHeadlines`: new ids only, `Drop` excluded, no previous snapshot counts everything
  - `renderDigest`: topic order, empty sections left out, HTML escaping, subject count
  - `sendEmail`: the command's shape
  - `sendNewsDigest`: sends when something is new, skips when nothing is, and treats a corrupt previous snapshot as none
  - the route: 503, 401 on missing and wrong token, 202 that schedules the work, with `after` mocked
- **Manual on dev:**
  1. `aws events put-events` with `detail {"env":"dev"}` → the route returns 202 → the email arrives.
  2. SES console shows the domain as verified with DKIM.
  3. The email passes DKIM and DMARC (check "Show original" in Gmail).

## 8. Cost

- Scheduler: 14M invocations a month free.
- API destinations: $0.20 per million.
- Custom bus events: $1 per million.
- SES: $0.10 per 1,000 emails.

All effectively $0.

The real cost is the daily refresh's OpenRouter tagging. At the measured ₹0.008 per new headline and roughly 100 new headlines a day, that's about ₹25 a month.

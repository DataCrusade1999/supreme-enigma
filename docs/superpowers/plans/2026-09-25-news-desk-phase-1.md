# News Desk Phase 1 (Infra, storage and feeds) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gated `/tools/news-desk` page that, on a manual Refresh, fetches 13 RSS sources, dedupes and age-filters the headlines, saves them to S3 and lists them newest first.

**Architecture:** Pure modules under `web/lib/news-desk/` (parse, dedupe, feeds, store, refresh), one POST route that runs a refresh and returns the snapshot, and a server-rendered page that reads the saved snapshot and hands it to a client component with the Refresh button. Terraform grants the Vercel role access to `news-desk/*` and adds the `NEWS_DESK_MODEL` env var that Phase 2 uses.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, zod 4, `fast-xml-parser` 4 (new; spec D11), `@aws-sdk/client-s3` via `web/lib/aws.ts`, Vitest + Testing Library, Playwright, Terraform.

**Spec:** `docs/superpowers/specs/2026-09-25-news-desk-design.md` (§4, §5.1, §5.2, §8, §11, §12 for this phase)

## Global Constraints

- Headlines older than 14 days, or with no parseable date, are discarded right after parsing (spec §5.2).
- A date with no time zone is IST: append `+0530`. Remove the comma in `24 Sep, 2026` before parsing (spec §5.2).
- Summaries are kept only for FT, Mint and Business Standard, stripped of HTML and cut to about 200 characters (spec §5.2).
- Dedupe key is the normalized title plus the UTC publish day; a direct-feed item beats a Google News item with the same key (spec §5.2).
- Client components must render the same thing on the server and in the browser: no `new Date()` during render. The page passes `nowIso` down.
- Tests under `web/lib/news-desk/` start with `// @vitest-environment node` (the repo default is jsdom; these modules are server-only and use `AbortSignal.timeout` and `node:crypto`).
- Feed timeout 8 s; a failed source is recorded in `sourceErrors` and does not fail the refresh (spec §12).
- Storage is the per-branch bucket in `S3_BUCKET_NAME`, keys under `news-desk/` (spec §8). Every write replaces the whole object.
- Refresh route: `maxDuration = 60` (spec §9).
- Refresh is manual only. Nothing is scheduled (spec §2).
- Env var names: `APP_AWS_REGION`, never `AWS_REGION` (CLAUDE.md).
- Plain prose in comments, docs, commits and PR text (CLAUDE.md "Writing").
- Commit trailer: `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.

Deliberate deviation from spec §9: no `GET /api/news-desk` in this phase. The page reads the snapshot on the server and the refresh route returns the new one, so nothing would call it. Add it if a later phase needs it.

## Review Focus

1. **First visit, before any snapshot exists.** Expect an empty state ("Nothing saved yet — press Refresh"), not an error. S3 returns 403 for a missing key unless the role has `s3:ListBucket`, so this depends on Task 1's IAM statement; `readSnapshot` returning `null` on `NoSuchKey` is pinned in Task 5.
2. **Storage not configured** (`S3_BUCKET_NAME` unset: local dev, Playwright, CI). Expect the page to render with a plain message and the refresh route to answer 503, not a 500 or a build failure. Pinned in Tasks 5, 6 and 7.
3. **A feed that hangs.** Expect it to be abandoned after 8 s and listed as failed while every other source is saved. Pinned in Task 4.
4. **The same story from Google News and from the publisher's own feed**, with typographic differences (curly vs straight apostrophe, trailing ` - Mint`). Expect one entry, linking to the publisher. Pinned in Task 3.
5. **Recurring releases with identical titles** (RBI's weekly "Government Stock - Auction Results: Cut-off"). Expect each week's release to appear, not only the first one until it ages out. Pinned in Task 3 by keying ids on title plus publish day.

Also handled, but less likely to bite: a stored snapshot that is corrupt or from an older shape. The page says it could not read the saved headlines and a Refresh replaces the file (Tasks 5 and 6).

---

## File Structure

| File | Responsibility |
|---|---|
| `infra/main/shared.tf` (modify) | IAM statements for `news-desk/*`; `NEWS_DESK_MODEL` env var |
| `infra/main/variables.tf` (modify) | `news_desk_model` variable |
| `infra/main/terraform.tfvars.example` (modify) | Document the new variable |
| `infra/main/environments.tf` (modify) | Lifecycle comment names `news-desk/` as a prefix that must persist |
| `web/lib/news-desk/types.ts` | Shared types and the zod snapshot schema |
| `web/lib/news-desk/parse.ts` | RSS XML → `Headline[]` for one source; date parsing; Google News suffix |
| `web/lib/news-desk/dedupe.ts` | Title normalization, ids, merge with age filter |
| `web/lib/news-desk/feeds.ts` | Source list; fetch all sources in parallel with timeout |
| `web/lib/news-desk/store.ts` | Read/write `news-desk/snapshot.json` |
| `web/lib/news-desk/refresh.ts` | Orchestrates one refresh |
| `web/lib/news-desk/format.ts` | "2h ago" formatting |
| `web/app/api/news-desk/refresh/route.ts` | POST: run a refresh |
| `web/app/tools/news-desk/page.tsx` | Server page: read snapshot, render shell |
| `web/components/news-desk/NewsDesk.tsx` | Client: refresh bar, errors, list |
| `web/components/news-desk/HeadlineList.tsx` | Presentational list |
| `web/lib/route-gate.ts`, `web/lib/site/commands.ts` (modify) | Gate `/api/news-desk`, list the tool, `open news-desk` |
| `web/e2e/news-desk.spec.ts`, `web/e2e/tools.spec.ts` (modify) | Reachability |
| `CHANGELOG.md`, `CLAUDE.md` (modify) | Unreleased entry; gated-route list |

Test fixtures live in `web/lib/news-desk/__fixtures__/` as trimmed copies of real feed responses recorded on 2026-09-25.

---

### Task 0: Branch and Phase 1 issue

No code. Sets up where the work lands.

- [ ] **Step 1: Rename the spec branch to the Phase 1 branch**

The spec and this plan are committed on `docs/news-desk-spec`. They ship in the Phase 1 PR, as the resume pipeline's spec did.

```bash
cd /e/Personal/looper && git branch -m docs/news-desk-spec feat/news-desk-phase-1
```

- [ ] **Step 2: File the Phase 1 issue and link it from the epic**

Ask the owner before running this; it creates a public record.

```bash
gh issue create --title "News Desk Phase 1: infra, storage and feeds" \
  --label enhancement --label "priority: medium" --label "area: finance" \
  --body "Part of #253. Gated /tools/news-desk page with manual Refresh: fetch 13 RSS sources, dedupe, drop items older than 14 days, save to S3, list newest first. Terraform: news-desk/* IAM and NEWS_DESK_MODEL.

Spec: docs/superpowers/specs/2026-09-25-news-desk-design.md
Plan: docs/superpowers/plans/2026-09-25-news-desk-phase-1.md"
```

Then edit #253's Phase 1 line to start with the new issue number (`gh issue edit 253 --body-file …`, changing `- [ ] **Phase 1:` to `- [ ] #<N> **Phase 1:`).

---

### Task 1: Terraform — IAM and model variable

**Files:**
- Modify: `infra/main/shared.tf` (the `aws_iam_role_policy.vercel` statement list; after the `openrouter_base_url` env var resource)
- Modify: `infra/main/variables.tf` (after `openrouter_model`)
- Modify: `infra/main/terraform.tfvars.example`
- Modify: `infra/main/environments.tf` (the "no catch-all rule" comment in `aws_s3_bucket_lifecycle_configuration.audio`)

**Interfaces:**
- Produces: Vercel env var `NEWS_DESK_MODEL`; the Vercel role can `GetObject`/`PutObject` on `<bucket>/news-desk/*` and `ListBucket` on all three audio buckets.

- [ ] **Step 1: Add the two IAM statements**

In `infra/main/shared.tf`, inside `aws_iam_role_policy.vercel`'s `Statement` list, directly after the `ResumeHeadObjectNotFound` statement:

```hcl
      {
        Sid      = "NewsDeskObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = [for arn in local.all_audio_bucket_arns : "${arn}/news-desk/*"]
      },
      {
        # Same reason as ResumeHeadObjectNotFound above: without ListBucket, S3 answers
        # a GetObject for a missing key with 403, not 404. The News Desk's first page
        # load reads a snapshot that does not exist yet, and would report that as a
        # permissions failure. Grants listing key names in the three audio buckets.
        Sid      = "NewsDeskMissingSnapshotIs404"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.all_audio_bucket_arns
      },
```

- [ ] **Step 2: Add the variable and env var**

In `infra/main/variables.tf`, after `variable "openrouter_model"`:

```hcl
variable "news_desk_model" {
  description = "Model slug for the News Desk's headline tagging and chat. Separate from openrouter_model so changing the resume extraction model does not change this tool."
  type        = string
  default     = "anthropic/claude-haiku-4.5"
}
```

In `infra/main/shared.tf`, after `resource "vercel_project_environment_variable" "openrouter_base_url"`:

```hcl
resource "vercel_project_environment_variable" "news_desk_model" {
  project_id = vercel_project.looper.id
  key        = "NEWS_DESK_MODEL"
  value      = var.news_desk_model
  target     = local.env_targets
  sensitive  = false
}
```

In `infra/main/terraform.tfvars.example`, after the `# openrouter_model = ...` line:

```hcl
# news_desk_model = "anthropic/claude-haiku-4.5"
```

- [ ] **Step 3: Name `news-desk/` in the lifecycle comment**

In `infra/main/environments.tf`, in the comment that begins `# There is deliberately NO catch-all rule`, change the sentence ending `would therefore delete resume/current.*, which is the single thing this configuration exists to keep.` to:

```hcl
  # number of days would therefore delete resume/current.* and the News Desk's
  # news-desk/*.json, which are the things this configuration exists to keep.
```

Keep the surrounding lines as they are.

- [ ] **Step 4: Format, validate and plan against real state**

```bash
cd /e/Personal/looper/infra/main && terraform fmt -check && terraform validate && terraform plan -var-file=terraform.tfvars -no-color | tail -40
```

Expected: `Plan: 1 to add, 1 to change, 0 to destroy.` The add is `vercel_project_environment_variable.news_desk_model`; the change is `aws_iam_role_policy.vercel` with the two new statements. If anything else appears, stop and report it.

Do not apply yet. The repo's merge gate for an `infra/` PR is `terraform plan` showing `No changes.`, which means the owner applies this branch's Terraform **before** the PR merges (Task 8 Step 6). The changes only add permissions and one env var, so applying ahead of the app code is harmless. Ask the owner before running `terraform apply`; never run it unprompted.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add infra/main/shared.tf infra/main/variables.tf infra/main/terraform.tfvars.example infra/main/environments.tf
git commit -m "feat(infra): grant news-desk/ S3 access and add NEWS_DESK_MODEL

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: Types and RSS parsing

**Files:**
- Create: `web/lib/news-desk/types.ts`
- Create: `web/lib/news-desk/parse.ts`
- Create: `web/lib/news-desk/__fixtures__/ft.xml`, `google-news.xml`, `rbi.xml`, `sebi.xml`, `mint.xml`
- Test: `web/lib/news-desk/parse.test.ts`
- Modify: `web/package.json` (add `fast-xml-parser`)

**Interfaces:**
- Produces:
  - `type SourceDef = { name: string; url: string; kind: "direct" | "google"; summary: boolean }`
  - `type Headline = { id: string; title: string; url: string; source: string; summary?: string; publishedAt: string; direct: boolean }` (`publishedAt` is ISO 8601 UTC)
  - `type SourceError = { source: string; message: string }`
  - `type Snapshot = { version: 1; refreshedAt: string; headlines: Headline[]; sourceErrors: SourceError[] }`
  - `snapshotSchema` (zod) validating `Snapshot`
  - `parsePubDate(raw: string | undefined): string | null`
  - `parseFeed(xml: string, source: SourceDef): Omit<Headline, "id">[]` — throws `Error("not an RSS feed")` when there is no `rss.channel`
- `id` is added in Task 3; `parse.ts` does not compute it.

- [ ] **Step 1: Install the XML parser**

```bash
cd /e/Personal/looper/web && npm install fast-xml-parser@^4.5.7
```

Version 4, not 5: v5 is a rewrite with a different option set, and the options below (`ignoreAttributes`, `parseTagValue`, `isArray`) are v4's. After installing, confirm each of the three appears in `node_modules/fast-xml-parser/README.md` or its linked options doc before relying on it.

- [ ] **Step 2: Write the fixtures**

Trimmed copies of real responses, recorded 2026-09-25. Create each file exactly as shown.

`web/lib/news-desk/__fixtures__/ft.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>India | Financial Times</title>
<item><title><![CDATA[Indian stock market will double in five years, says Motilal Oswal’s Raamdeo Agrawal]]></title><description><![CDATA[Foreign investors have oversold the correction, the billionaire investor says in our latest India Business Briefing Q&A]]></description><link>https://www.ft.com/content/dbe10037-caf0-475c-b05e-692df41c31eb?syn-25a6b1a6=1</link><guid isPermaLink="false">dbe10037-caf0-475c-b05e-692df41c31eb</guid><pubDate>Fri, 25 Sep 2026 01:30:06 GMT</pubDate></item>
</channel></rss>
```

`web/lib/news-desk/__fixtures__/google-news.xml`:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>"site:reuters.com India economy when:7d" - Google News</title>
<item><title>India to continue prudent fiscal management, chief economic advisor says - Reuters</title><link>https://news.google.com/rss/articles/CBMitwFBVV95cUxN?oc=5</link><guid isPermaLink="false">CBMitwFBVV95cUxN</guid><pubDate>Mon, 21 Sep 2026 08:01:43 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/CBMitwFBVV95cUxN?oc=5"&gt;India to continue prudent fiscal management&lt;/a&gt;</description><source url="https://www.reuters.com">Reuters</source></item>
<item><title>Tata &amp; Sons – a profile - Mumbai edition - Business Standard</title><link>https://news.google.com/rss/articles/XYZ?oc=5</link><guid isPermaLink="false">XYZ</guid><pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate><description>ignored</description><source url="https://www.business-standard.com">Business Standard</source></item>
<item><title>Budget talk begins - Mint</title><link>https://news.google.com/rss/articles/NOSRC?oc=5</link><guid isPermaLink="false">NOSRC</guid><pubDate>Tue, 22 Sep 2026 09:00:00 GMT</pubDate></item>
</channel></rss>
```

`web/lib/news-desk/__fixtures__/rbi.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>RBI Press Releases</title>
<item><title><![CDATA[Government Stock - Auction Results: Cut-off]]></title><description><![CDATA[<table width="100%"><tr><td>6.94% GS 2035</td></tr></table>]]></description><link>https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61234</link><pubDate>Fri, 25 Sep 2026 14:05:00</pubDate></item>
</channel></rss>
```

`web/lib/news-desk/__fixtures__/sebi.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>SEBI</title>
<item><title>Order in the matter of Non-Compliance of Minimum Public Shareholding in Omaxe Limited</title><description>Order in the matter of Non-Compliance of Minimum Public Shareholding in Omaxe Limited</description><link>https://www.sebi.gov.in/enforcement/orders/sep-2026/order-omaxe_104726.html</link><pubDate>24 Sep, 2026 +0530</pubDate></item>
<item><title>Undated circular</title><link>https://www.sebi.gov.in/x.html</link></item>
</channel></rss>
```

`web/lib/news-desk/__fixtures__/mint.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Mint Economy</title>
<item>
	<title><![CDATA[Cabinet to soon decide on new bilateral investment treaty template to ease dispute settlements]]></title>
	<link><![CDATA[https://www.livemint.com/economy/cabinet-bilateral-investment-treaty-template-dispute-settlements-11790315746392.html]]></link>
	<description><![CDATA[The proposed model will <b>substantially</b> shorten the five-year mandatory litigation timeframe for companies under the existing 2015 template before pursuing global arbitration for dispute settlement, according to officials familiar with the draft, which is expected to go before the Union Cabinet within weeks.]]></description>
	<pubDate><![CDATA[Fri, 25 Sep 2026 12:03:48 +0530]]></pubDate>
	<media:content medium="image" url="https://www.livemint.com/img.jpg"/>
</item>
</channel></rss>
```

- [ ] **Step 3: Write the failing tests**

`web/lib/news-desk/parse.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeed, parsePubDate } from "./parse";
import type { SourceDef } from "./types";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

const direct = (name: string, summary = false): SourceDef => ({
  name,
  url: "https://example.test/feed",
  kind: "direct",
  summary,
});
const google: SourceDef = {
  name: "Google News: Reuters",
  url: "https://news.google.com/rss/search?q=x",
  kind: "google",
  summary: false,
};

describe("parsePubDate", () => {
  it("parses an RFC 822 date with GMT", () => {
    expect(parsePubDate("Wed, 23 Sep 2026 11:15:00 GMT")).toBe("2026-09-23T11:15:00.000Z");
  });

  it("parses a numeric offset", () => {
    expect(parsePubDate("Fri, 25 Sep 2026 12:45:21 +0530")).toBe("2026-09-25T07:15:21.000Z");
  });

  it("treats a date with no zone as IST, not as the server's local time", () => {
    // RBI omits the zone. Vercel runs in UTC, so a bare parse would be 5.5 hours late.
    expect(parsePubDate("Fri, 25 Sep 2026 14:05:00")).toBe("2026-09-25T08:35:00.000Z");
  });

  it("parses SEBI's '24 Sep, 2026 +0530'", () => {
    expect(parsePubDate("24 Sep, 2026 +0530")).toBe("2026-09-23T18:30:00.000Z");
  });

  it("returns null for missing or unparseable input", () => {
    expect(parsePubDate(undefined)).toBeNull();
    expect(parsePubDate("")).toBeNull();
    expect(parsePubDate("sometime last week")).toBeNull();
  });
});

describe("parseFeed", () => {
  it("reads a direct feed with CDATA and keeps its summary when asked", () => {
    const [item] = parseFeed(fixture("ft.xml"), direct("FT", true));
    expect(item).toEqual({
      title: "Indian stock market will double in five years, says Motilal Oswal’s Raamdeo Agrawal",
      url: "https://www.ft.com/content/dbe10037-caf0-475c-b05e-692df41c31eb?syn-25a6b1a6=1",
      source: "FT",
      summary:
        "Foreign investors have oversold the correction, the billionaire investor says in our latest India Business Briefing Q&A",
      publishedAt: "2026-09-25T01:30:06.000Z",
      direct: true,
    });
  });

  it("strips HTML from a summary and cuts it to about 200 characters", () => {
    const [item] = parseFeed(fixture("mint.xml"), direct("Mint", true));
    expect(item.summary).not.toContain("<b>");
    expect(item.summary).toContain("substantially shorten");
    expect(item.summary!.length).toBeLessThanOrEqual(201);
    expect(item.summary!.endsWith("…")).toBe(true);
    expect(item.url).toBe(
      "https://www.livemint.com/economy/cabinet-bilateral-investment-treaty-template-dispute-settlements-11790315746392.html",
    );
  });

  it("drops the summary for sources not flagged for it", () => {
    const [item] = parseFeed(fixture("rbi.xml"), direct("RBI press releases"));
    expect(item.summary).toBeUndefined();
    expect(item.publishedAt).toBe("2026-09-25T08:35:00.000Z");
  });

  it("drops items with no parseable date", () => {
    const items = parseFeed(fixture("sebi.xml"), direct("SEBI"));
    expect(items.map((i) => i.title)).toEqual([
      "Order in the matter of Non-Compliance of Minimum Public Shareholding in Omaxe Limited",
    ]);
  });

  it("takes a Google News item's source from <source> and strips it from the title", () => {
    const [first, second] = parseFeed(fixture("google-news.xml"), google);
    expect(first).toMatchObject({
      title: "India to continue prudent fiscal management, chief economic advisor says",
      source: "Reuters",
      direct: false,
      url: "https://news.google.com/rss/articles/CBMitwFBVV95cUxN?oc=5",
    });
    expect(first.summary).toBeUndefined();
    // A " - " inside the headline is not mistaken for the publisher, and
    // entities are decoded once.
    expect(second.title).toBe("Tata & Sons – a profile - Mumbai edition");
    expect(second.source).toBe("Business Standard");
  });

  it("falls back to the title suffix when a Google News item has no <source>", () => {
    const third = parseFeed(fixture("google-news.xml"), google)[2];
    expect(third.title).toBe("Budget talk begins");
    expect(third.source).toBe("Mint");
  });

  it("rejects something that is not RSS, such as a 200 HTML error page", () => {
    expect(() => parseFeed("<html><body>Access denied</body></html>", direct("X"))).toThrow(
      "not an RSS feed",
    );
  });

  it("returns an empty list for a channel with no items", () => {
    expect(parseFeed('<rss><channel><title>t</title></channel></rss>', direct("X"))).toEqual([]);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/parse.test.ts`
Expected: FAIL, cannot resolve `./parse`.

- [ ] **Step 5: Implement**

`web/lib/news-desk/types.ts`:

```ts
import { z } from "zod";

export type SourceDef = {
  name: string;
  url: string;
  // "google" items come through Google News: their title carries the publisher
  // as a " - Publisher" suffix and their link is a news.google.com redirect.
  kind: "direct" | "google";
  // Only some feeds have a description worth showing. RBI's is an HTML table and
  // SEBI's repeats the title. See the design spec §5.2.
  summary: boolean;
};

export const headlineSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  source: z.string(),
  summary: z.string().optional(),
  publishedAt: z.string(),
  direct: z.boolean(),
});
export type Headline = z.infer<typeof headlineSchema>;

export const sourceErrorSchema = z.object({ source: z.string(), message: z.string() });
export type SourceError = z.infer<typeof sourceErrorSchema>;

export const snapshotSchema = z.object({
  version: z.literal(1),
  refreshedAt: z.string(),
  headlines: z.array(headlineSchema),
  sourceErrors: z.array(sourceErrorSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
```

`web/lib/news-desk/parse.ts`:

```ts
import { XMLParser } from "fast-xml-parser";
import type { Headline, SourceDef } from "./types";

const SUMMARY_MAX = 200;

const parser = new XMLParser({
  ignoreAttributes: true,
  // Keep every value a string. The default turns a title like "2026" into a number.
  parseTagValue: false,
  isArray: (name) => name === "item",
});

// A zone at the end: GMT, UTC, Z, or a numeric offset like +0530 / +05:30.
const HAS_ZONE = /(GMT|UTC|Z|[+-]\d{2}:?\d{2})\s*$/i;

/** ISO 8601 UTC, or null. Feeds without a zone publish in IST (RBI does), and
 * SEBI writes "24 Sep, 2026 +0530", which Date.parse rejects because of the comma. */
export function parsePubDate(raw: string | undefined): string | null {
  if (!raw) return null;
  let text = raw.trim().replace(/^(\d{1,2} [A-Za-z]{3}),/, "$1");
  if (!text) return null;
  if (!HAS_ZONE.test(text)) text += " +0530";
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Descriptions arrive as HTML inside CDATA, so the XML parser leaves their
// entities alone. Titles are already decoded by the parser and must not pass
// through here, or "&amp;amp;" would decode twice.
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function toSummary(html: string): string | undefined {
  const text = decodeHtmlEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= SUMMARY_MAX) return text;
  return text.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "") + "…";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseFeed(xml: string, source: SourceDef): Omit<Headline, "id">[] {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel) throw new Error("not an RSS feed");
  const items: unknown[] = channel.item ?? [];

  const out: Omit<Headline, "id">[] = [];
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    let title = text(item.title);
    const url = text(item.link);
    const publishedAt = parsePubDate(text(item.pubDate));
    if (!title || !url || !publishedAt) continue;

    let name = source.name;
    if (source.kind === "google") {
      // Google News names the publisher in <source> and repeats it as a
      // " - Publisher" title suffix. Trust <source>; guess from the last " - "
      // only when it is missing, since headlines contain " - " themselves.
      const publisher = text(item.source);
      if (publisher) {
        name = publisher;
        const suffix = ` - ${publisher}`;
        if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
      } else {
        const cut = title.lastIndexOf(" - ");
        if (cut > 0) {
          name = title.slice(cut + 3).trim();
          title = title.slice(0, cut).trim();
        }
      }
    }

    const summary = source.summary ? toSummary(text(item.description)) : undefined;
    out.push({
      title,
      url,
      source: name,
      ...(summary ? { summary } : {}),
      publishedAt,
      direct: source.kind === "direct",
    });
  }
  return out;
}
```

- [ ] **Step 6: Run to verify pass**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/parse.test.ts`
Expected: PASS, 13 tests.

If the SEBI date test fails, `Date.parse` on this Node version does not accept `24 Sep 2026 +0530`. Rewrite that shape to `24 Sep 2026 00:00:00 +0530` in `parsePubDate` (insert `00:00:00` when the text has no `:`), and rerun.

- [ ] **Step 7: Commit**

```bash
cd /e/Personal/looper/web && git add package.json package-lock.json lib/news-desk/types.ts lib/news-desk/parse.ts lib/news-desk/parse.test.ts lib/news-desk/__fixtures__
git commit -m "feat(news-desk): parse RSS feeds into headlines

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: Dedupe and age filter

**Files:**
- Create: `web/lib/news-desk/dedupe.ts`
- Test: `web/lib/news-desk/dedupe.test.ts`

**Interfaces:**
- Consumes: `Headline` from `./types`
- Produces:
  - `MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000`
  - `normalizeTitle(title: string): string`
  - `withId(item: Omit<Headline, "id">): Headline` — `id` is the first 16 hex chars of SHA-1 of `normalizedTitle + "|" + publishedAt.slice(0, 10)` (title plus UTC publish day)
  - `mergeHeadlines(existing: Headline[], incoming: Headline[], now: Date): Headline[]` — drops items older than `MAX_AGE_MS`, one item per `id` (existing wins over incoming unless incoming is direct and existing is not), sorted by `publishedAt` descending

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/dedupe.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, mergeHeadlines, normalizeTitle, withId } from "./dedupe";
import type { Headline } from "./types";

const NOW = new Date("2026-09-25T12:00:00.000Z");

function item(over: Partial<Omit<Headline, "id">> = {}): Headline {
  return withId({
    title: "RBI keeps repo rate unchanged",
    url: "https://news.google.com/rss/articles/abc",
    source: "Reuters",
    publishedAt: "2026-09-25T09:00:00.000Z",
    direct: false,
    ...over,
  });
}

describe("normalizeTitle", () => {
  it("ignores case, punctuation and curly vs straight quotes", () => {
    expect(normalizeTitle("India’s GDP: Up 7%!")).toBe(normalizeTitle("india's gdp up 7%"));
  });

  it("collapses whitespace", () => {
    expect(normalizeTitle("  RBI   holds  ")).toBe("rbi holds");
  });
});

describe("withId", () => {
  it("gives the same id to titles that differ only in punctuation", () => {
    expect(item({ title: "India’s exports rise" }).id).toBe(item({ title: "India's exports rise." }).id);
  });

  it("gives different ids to different titles", () => {
    expect(item({ title: "A" }).id).not.toBe(item({ title: "B" }).id);
  });

  it("is 16 hex characters", () => {
    expect(item().id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("keeps a recurring release with the same title as a separate item each week", () => {
    // RBI publishes "Government Stock - Auction Results: Cut-off" every week.
    const title = "Government Stock - Auction Results: Cut-off";
    const lastWeek = item({ title, publishedAt: "2026-09-18T08:35:00.000Z" });
    const thisWeek = item({ title, publishedAt: "2026-09-25T08:35:00.000Z" });
    expect(lastWeek.id).not.toBe(thisWeek.id);
    expect(mergeHeadlines([lastWeek], [thisWeek], NOW)).toHaveLength(2);
  });
});

describe("mergeHeadlines", () => {
  it("keeps one item per story and prefers the publisher's own link", () => {
    const viaGoogle = item({ title: "Cabinet approves BIT template", source: "Mint" });
    const direct = item({
      title: "Cabinet approves BIT template",
      source: "Mint",
      url: "https://www.livemint.com/economy/bit",
      direct: true,
    });
    const merged = mergeHeadlines([], [viaGoogle, direct], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0].url).toBe("https://www.livemint.com/economy/bit");
  });

  it("keeps an existing item over a new non-direct copy of it", () => {
    const stored = item({ url: "https://stored.example/1", direct: true });
    const again = item({ url: "https://news.google.com/other" });
    expect(mergeHeadlines([stored], [again], NOW)[0].url).toBe("https://stored.example/1");
  });

  it("drops anything older than 14 days, stored or new", () => {
    const old = new Date(NOW.getTime() - MAX_AGE_MS - 1000).toISOString();
    const merged = mergeHeadlines(
      [item({ title: "stored old", publishedAt: old })],
      [item({ title: "new old", publishedAt: old }), item({ title: "fresh" })],
      NOW,
    );
    expect(merged.map((h) => h.title)).toEqual(["fresh"]);
  });

  it("sorts newest first", () => {
    const merged = mergeHeadlines(
      [],
      [
        item({ title: "older", publishedAt: "2026-09-24T00:00:00.000Z" }),
        item({ title: "newer", publishedAt: "2026-09-25T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(merged.map((h) => h.title)).toEqual(["newer", "older"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/dedupe.test.ts`
Expected: FAIL, cannot resolve `./dedupe`.

- [ ] **Step 3: Implement**

`web/lib/news-desk/dedupe.ts`:

```ts
import { createHash } from "node:crypto";
import type { Headline } from "./types";

export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The dedupe key. Google News links are news.google.com redirects, so the same
 * story never shares a URL with the publisher's own feed; the title is all that
 * matches. See the design spec §5.2. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛'`]/g, "")
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();
}

// The publish day is part of the key so a recurring release with a fixed title
// (RBI's weekly auction results) is a new item each week instead of being
// swallowed by last week's copy. The same story from Google News and from the
// publisher carries the same timestamp, so cross-source dedupe still works.
export function withId(item: Omit<Headline, "id">): Headline {
  const key = `${normalizeTitle(item.title)}|${item.publishedAt.slice(0, 10)}`;
  const id = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return { id, ...item };
}

export function mergeHeadlines(existing: Headline[], incoming: Headline[], now: Date): Headline[] {
  const cutoff = now.getTime() - MAX_AGE_MS;
  const byId = new Map<string, Headline>();
  // Existing first, so a stored item survives a later copy of the same story;
  // the one exception is a direct-feed copy replacing a Google News one.
  for (const headline of [...existing, ...incoming]) {
    if (Date.parse(headline.publishedAt) < cutoff) continue;
    const kept = byId.get(headline.id);
    if (!kept || (!kept.direct && headline.direct)) byId.set(headline.id, headline);
  }
  return [...byId.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/dedupe.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper/web && git add lib/news-desk/dedupe.ts lib/news-desk/dedupe.test.ts
git commit -m "feat(news-desk): dedupe headlines by title and drop old ones

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: Source list and parallel fetch

**Files:**
- Create: `web/lib/news-desk/feeds.ts`
- Test: `web/lib/news-desk/feeds.test.ts`

**Interfaces:**
- Consumes: `parseFeed` (Task 2), `withId` (Task 3), types
- Produces:
  - `SOURCES: SourceDef[]` (13 entries)
  - `FEED_TIMEOUT_MS = 8000`
  - `fetchAllFeeds(options?: { sources?: SourceDef[]; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<{ headlines: Headline[]; errors: SourceError[] }>`

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/feeds.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchAllFeeds, SOURCES } from "./feeds";
import type { SourceDef } from "./types";

const FT = readFileSync(join(__dirname, "__fixtures__", "ft.xml"), "utf8");

const ok: SourceDef = { name: "FT", url: "https://ok.test/rss", kind: "direct", summary: true };
const broken: SourceDef = { name: "Broken", url: "https://broken.test/rss", kind: "direct", summary: false };
const slow: SourceDef = { name: "Slow", url: "https://slow.test/rss", kind: "direct", summary: false };

// A fetch that answers per URL and, like the real one, rejects when its signal aborts.
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://ok.test")) return new Response(FT, { status: 200 });
  if (url.startsWith("https://broken.test")) return new Response("Forbidden", { status: 403 });
  return new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });
}) as typeof fetch;

describe("SOURCES", () => {
  it("has 13 sources with unique names and https URLs", () => {
    expect(SOURCES).toHaveLength(13);
    expect(new Set(SOURCES.map((s) => s.name)).size).toBe(13);
    for (const s of SOURCES) expect(s.url.startsWith("https://")).toBe(true);
  });

  it("restricts every Google News query to the last 7 days", () => {
    for (const s of SOURCES.filter((s) => s.kind === "google")) {
      expect(decodeURIComponent(new URL(s.url).searchParams.get("q")!)).toContain("when:7d");
    }
  });

  it("keeps summaries only for FT, Mint and Business Standard", () => {
    expect(SOURCES.filter((s) => s.summary).map((s) => s.name).sort()).toEqual([
      "Business Standard",
      "FT",
      "Mint",
    ]);
  });
});

describe("fetchAllFeeds", () => {
  it("returns headlines with ids from the sources that worked", async () => {
    const { headlines, errors } = await fetchAllFeeds({ sources: [ok], fetchImpl: fakeFetch });
    expect(errors).toEqual([]);
    expect(headlines).toHaveLength(1);
    expect(headlines[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(headlines[0].source).toBe("FT");
  });

  it("records a failed source and still returns the others", async () => {
    const { headlines, errors } = await fetchAllFeeds({
      sources: [ok, broken],
      fetchImpl: fakeFetch,
    });
    expect(headlines).toHaveLength(1);
    expect(errors).toEqual([{ source: "Broken", message: "status 403" }]);
  });

  it("gives up on a source that hangs, without waiting for it", async () => {
    const started = Date.now();
    const { headlines, errors } = await fetchAllFeeds({
      sources: [ok, slow],
      fetchImpl: fakeFetch,
      timeoutMs: 50,
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(headlines).toHaveLength(1);
    expect(errors).toEqual([{ source: "Slow", message: "timed out" }]);
  });

  it("records a 200 response that is not RSS", async () => {
    const htmlFetch = (async () => new Response("<html></html>", { status: 200 })) as typeof fetch;
    const { errors } = await fetchAllFeeds({ sources: [ok], fetchImpl: htmlFetch });
    expect(errors).toEqual([{ source: "FT", message: "not an RSS feed" }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/feeds.test.ts`
Expected: FAIL, cannot resolve `./feeds`.

- [ ] **Step 3: Implement**

`web/lib/news-desk/feeds.ts`:

```ts
import { withId } from "./dedupe";
import { parseFeed } from "./parse";
import type { Headline, SourceDef, SourceError } from "./types";

export const FEED_TIMEOUT_MS = 8000;

// Some publishers refuse requests with no User-Agent.
const USER_AGENT = "Mozilla/5.0 (compatible; NewsDesk/1.0)";

function googleNews(name: string, query: string): SourceDef {
  const q = encodeURIComponent(`${query} when:7d`);
  return {
    name,
    url: `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`,
    kind: "google",
    summary: false,
  };
}

// Checked by hand on 2026-09-25; see the design spec §5.1 for what each returned
// and why The Economist, PRS, PIB, Reuters and Bloomberg go through Google News.
export const SOURCES: SourceDef[] = [
  { name: "FT", url: "https://www.ft.com/world/asia-pacific/india?format=rss", kind: "direct", summary: true },
  { name: "RBI press releases", url: "https://www.rbi.org.in/pressreleases_rss.xml", kind: "direct", summary: false },
  { name: "RBI notifications", url: "https://www.rbi.org.in/notifications_rss.xml", kind: "direct", summary: false },
  { name: "SEBI", url: "https://www.sebi.gov.in/sebirss.xml", kind: "direct", summary: false },
  { name: "Mint", url: "https://www.livemint.com/rss/economy", kind: "direct", summary: true },
  { name: "Business Standard", url: "https://www.business-standard.com/rss/economy-102.rss", kind: "direct", summary: true },
  googleNews("Google News: Reuters", "site:reuters.com India economy"),
  googleNews("Google News: Bloomberg", "site:bloomberg.com India"),
  googleNews("Google News: The Economist", "site:economist.com India"),
  googleNews("Google News: PRS", "site:prsindia.org"),
  // Unfiltered, site:pib.gov.in returns the 100-item cap every time, mostly
  // ministry notices unrelated to the economy. Narrowed to the topics this desk covers.
  googleNews(
    "Google News: PIB",
    "site:pib.gov.in (Cabinet OR economy OR bill OR GDP OR inflation OR GST OR reform OR RBI)",
  ),
  googleNews(
    "Google News: legislation",
    'India (bill OR ordinance OR amendment) ("Lok Sabha" OR "Rajya Sabha")',
  ),
  googleNews(
    "Google News: reforms",
    'India ("Cabinet approves" OR "GST Council" OR "labour codes" OR disinvestment OR reform)',
  ),
];

async function fetchOne(source: SourceDef, fetchImpl: typeof fetch, timeoutMs: number): Promise<Headline[]> {
  let res: Response;
  try {
    res = await fetchImpl(source.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "timed out" : "network error");
  }
  if (!res.ok) throw new Error(`status ${res.status}`);
  return parseFeed(await res.text(), source).map(withId);
}

export async function fetchAllFeeds(
  options: { sources?: SourceDef[]; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ headlines: Headline[]; errors: SourceError[] }> {
  const { sources = SOURCES, fetchImpl = fetch, timeoutMs = FEED_TIMEOUT_MS } = options;
  const results = await Promise.allSettled(sources.map((s) => fetchOne(s, fetchImpl, timeoutMs)));

  const headlines: Headline[] = [];
  const errors: SourceError[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") headlines.push(...result.value);
    else errors.push({ source: sources[i].name, message: (result.reason as Error).message });
  });
  return { headlines, errors };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/feeds.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper/web && git add lib/news-desk/feeds.ts lib/news-desk/feeds.test.ts
git commit -m "feat(news-desk): fetch all sources in parallel with a timeout

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: Snapshot storage

**Files:**
- Create: `web/lib/news-desk/store.ts`
- Test: `web/lib/news-desk/store.test.ts`

**Interfaces:**
- Consumes: `getObjectBytes(bucket, key): Promise<Buffer>`, `putObjectJson(bucket, key, body): Promise<void>` from `@/lib/aws`; `snapshotSchema`, `Snapshot`
- Produces:
  - `SNAPSHOT_KEY = "news-desk/snapshot.json"`
  - `isStorageConfigured(): boolean`
  - `class SnapshotCorruptError extends Error`
  - `readSnapshot(): Promise<Snapshot | null>` — `null` when the object does not exist; throws `SnapshotCorruptError` for invalid JSON or schema; rethrows anything else
  - `writeSnapshot(snapshot: Snapshot): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`web/lib/news-desk/store.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  getObjectBytes: vi.fn(),
  putObjectJson: vi.fn(),
}));

import { getObjectBytes, putObjectJson } from "@/lib/aws";
import {
  isStorageConfigured,
  readSnapshot,
  SNAPSHOT_KEY,
  SnapshotCorruptError,
  writeSnapshot,
} from "./store";
import type { Snapshot } from "./types";

const SNAPSHOT: Snapshot = {
  version: 1,
  refreshedAt: "2026-09-25T12:00:00.000Z",
  headlines: [],
  sourceErrors: [],
};

describe("news-desk store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "audio-bucket";
  });

  it("reads and validates the snapshot from the branch bucket", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(SNAPSHOT)));
    expect(await readSnapshot()).toEqual(SNAPSHOT);
    expect(getObjectBytes).toHaveBeenCalledWith("audio-bucket", SNAPSHOT_KEY);
  });

  it("returns null before the first refresh has written anything", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(
      Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }),
    );
    expect(await readSnapshot()).toBeNull();
  });

  it("does not report a permissions failure as 'nothing saved yet'", async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(
      Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }),
    );
    await expect(readSnapshot()).rejects.toThrow("AccessDenied");
  });

  it("flags a snapshot that is not JSON as corrupt", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from("not json"));
    await expect(readSnapshot()).rejects.toBeInstanceOf(SnapshotCorruptError);
  });

  it("flags a snapshot of the wrong shape as corrupt", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify({ version: 2 })));
    await expect(readSnapshot()).rejects.toBeInstanceOf(SnapshotCorruptError);
  });

  it("writes the whole snapshot to the same key", async () => {
    await writeSnapshot(SNAPSHOT);
    expect(putObjectJson).toHaveBeenCalledWith("audio-bucket", SNAPSHOT_KEY, SNAPSHOT);
  });

  it("knows when no bucket is configured", () => {
    delete process.env.S3_BUCKET_NAME;
    expect(isStorageConfigured()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/store.test.ts`
Expected: FAIL, cannot resolve `./store`.

- [ ] **Step 3: Implement**

`web/lib/news-desk/store.ts`:

```ts
import { getObjectBytes, putObjectJson } from "@/lib/aws";
import { snapshotSchema, type Snapshot } from "./types";

export const SNAPSHOT_KEY = "news-desk/snapshot.json";

/** The stored file exists but cannot be used. A refresh overwrites it; see refresh.ts. */
export class SnapshotCorruptError extends Error {}

// The per-branch bucket, unlike the resume, which lives in main's bucket on every
// branch. Unset in local dev, Playwright and CI builds.
export function isStorageConfigured(): boolean {
  return Boolean(process.env.S3_BUCKET_NAME);
}

function bucket(): string {
  const name = process.env.S3_BUCKET_NAME;
  if (!name) throw new Error("S3_BUCKET_NAME is not set");
  return name;
}

export async function readSnapshot(): Promise<Snapshot | null> {
  let bytes: Buffer;
  try {
    bytes = await getObjectBytes(bucket(), SNAPSHOT_KEY);
  } catch (err) {
    // Only a missing object means "nothing saved yet". Anything else — an IAM
    // change, an expired credential — has to surface. This relies on the role
    // holding s3:ListBucket; without it a missing key is AccessDenied.
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new SnapshotCorruptError("stored snapshot is not valid JSON");
  }
  const parsed = snapshotSchema.safeParse(json);
  if (!parsed.success) throw new SnapshotCorruptError("stored snapshot does not match the schema");
  return parsed.data;
}

export async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await putObjectJson(bucket(), SNAPSHOT_KEY, snapshot);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/store.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper/web && git add lib/news-desk/store.ts lib/news-desk/store.test.ts
git commit -m "feat(news-desk): read and write the snapshot in S3

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: Refresh orchestration and route, gated

**Files:**
- Create: `web/lib/news-desk/refresh.ts`
- Test: `web/lib/news-desk/refresh.test.ts`
- Create: `web/app/api/news-desk/refresh/route.ts`
- Test: `web/app/api/news-desk/refresh/route.test.ts`
- Modify: `web/lib/route-gate.ts` (`GATED_PREFIXES`)
- Modify: `web/lib/route-gate.test.ts` (`isGatedPath` cases)

**Interfaces:**
- Consumes: `fetchAllFeeds` (Task 4), `mergeHeadlines` (Task 3), `readSnapshot`, `writeSnapshot`, `SnapshotCorruptError`, `isStorageConfigured` (Task 5)
- Produces:
  - `runRefresh(now?: Date): Promise<Snapshot>`
  - `POST /api/news-desk/refresh` → 200 `Snapshot` JSON; 503 `{ error: "storage not configured" }` when `S3_BUCKET_NAME` is unset; 500 `{ error: "refresh failed" }` when reading or writing S3 fails

- [ ] **Step 1: Write the failing orchestration tests**

`web/lib/news-desk/refresh.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./feeds", () => ({ fetchAllFeeds: vi.fn() }));
vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return { ...actual, readSnapshot: vi.fn(), writeSnapshot: vi.fn() };
});

import { fetchAllFeeds } from "./feeds";
import { withId } from "./dedupe";
import { readSnapshot, SnapshotCorruptError, writeSnapshot } from "./store";
import { runRefresh } from "./refresh";
import type { Snapshot } from "./types";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const fresh = withId({
  title: "New story",
  url: "https://ft.example/new",
  source: "FT",
  publishedAt: "2026-09-25T10:00:00.000Z",
  direct: true,
});
const stored = withId({
  title: "Stored story",
  url: "https://ft.example/stored",
  source: "FT",
  publishedAt: "2026-09-24T10:00:00.000Z",
  direct: true,
});

describe("runRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAllFeeds).mockResolvedValue({
      headlines: [fresh],
      errors: [{ source: "SEBI", message: "timed out" }],
    });
  });

  it("merges new headlines into the stored ones and saves the result", async () => {
    const previous: Snapshot = {
      version: 1,
      refreshedAt: "2026-09-24T12:00:00.000Z",
      headlines: [stored],
      sourceErrors: [],
    };
    vi.mocked(readSnapshot).mockResolvedValue(previous);

    const result = await runRefresh(NOW);

    expect(result).toEqual({
      version: 1,
      refreshedAt: "2026-09-25T12:00:00.000Z",
      headlines: [fresh, stored],
      sourceErrors: [{ source: "SEBI", message: "timed out" }],
    });
    expect(writeSnapshot).toHaveBeenCalledWith(result);
  });

  it("starts from nothing on the first refresh", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(null);
    const result = await runRefresh(NOW);
    expect(result.headlines).toEqual([fresh]);
  });

  it("replaces a corrupt snapshot instead of failing forever", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(new SnapshotCorruptError("bad"));
    const result = await runRefresh(NOW);
    expect(result.headlines).toEqual([fresh]);
    expect(writeSnapshot).toHaveBeenCalled();
  });

  it("does not overwrite the snapshot when S3 itself fails", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(
      Object.assign(new Error("AccessDenied"), { name: "AccessDenied" }),
    );
    await expect(runRefresh(NOW)).rejects.toThrow("AccessDenied");
    expect(writeSnapshot).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/refresh.test.ts`
Expected: FAIL, cannot resolve `./refresh`.

- [ ] **Step 3: Implement `refresh.ts`**

`web/lib/news-desk/refresh.ts`:

```ts
import { mergeHeadlines } from "./dedupe";
import { fetchAllFeeds } from "./feeds";
import { readSnapshot, SnapshotCorruptError, writeSnapshot } from "./store";
import type { Headline, Snapshot } from "./types";

export async function runRefresh(now: Date = new Date()): Promise<Snapshot> {
  // Read before fetching: if S3 is unreachable there is no point spending the
  // feed round-trips, and nothing must be written over a snapshot we could not read.
  let existing: Headline[] = [];
  try {
    existing = (await readSnapshot())?.headlines ?? [];
  } catch (err) {
    // A corrupt file would otherwise fail every refresh until someone deleted it
    // by hand. Replacing it loses at most 14 days of headlines the feeds still carry.
    if (!(err instanceof SnapshotCorruptError)) throw err;
    console.error("news-desk: replacing a corrupt snapshot", err);
  }

  const { headlines, errors } = await fetchAllFeeds();
  const snapshot: Snapshot = {
    version: 1,
    refreshedAt: now.toISOString(),
    headlines: mergeHeadlines(existing, headlines, now),
    sourceErrors: errors,
  };
  await writeSnapshot(snapshot);
  return snapshot;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/refresh.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing route and gate tests**

`web/app/api/news-desk/refresh/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/news-desk/refresh", () => ({ runRefresh: vi.fn() }));

import { runRefresh } from "@/lib/news-desk/refresh";
import { maxDuration, POST } from "./route";

describe("POST /api/news-desk/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "audio-bucket";
  });

  it("returns the new snapshot", async () => {
    const snapshot = { version: 1, refreshedAt: "x", headlines: [], sourceErrors: [] };
    vi.mocked(runRefresh).mockResolvedValue(snapshot as never);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(snapshot);
  });

  it("answers 503 when no bucket is configured, without fetching anything", async () => {
    delete process.env.S3_BUCKET_NAME;
    const res = await POST();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "storage not configured" });
    expect(runRefresh).not.toHaveBeenCalled();
  });

  it("answers 500 with a readable body when S3 fails", async () => {
    vi.mocked(runRefresh).mockRejectedValue(new Error("AccessDenied"));
    const res = await POST();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "refresh failed" });
  });

  it("allows the full 60 seconds", () => {
    expect(maxDuration).toBe(60);
  });
});
```

In `web/lib/route-gate.test.ts`, add these rows to the `isGatedPath` `it.each` table, after `["/api/newsletter/send", true],`:

```ts
    ["/api/news-desk/refresh", true],
    ["/tools/news-desk", true],
```

- [ ] **Step 6: Run to verify failure**

Run: `cd /e/Personal/looper/web && npx vitest run app/api/news-desk lib/route-gate.test.ts`
Expected: FAIL — route module missing, and `isGatedPath("/api/news-desk/refresh")` is `false`.

- [ ] **Step 7: Implement the route and the gate entry**

`web/app/api/news-desk/refresh/route.ts`:

```ts
import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/news-desk/refresh";
import { isStorageConfigured } from "@/lib/news-desk/store";

// Thirteen feeds in parallel take about 2 s; later phases add tagging and
// MoSPI calls to the same request. See the design spec §9.
export const maxDuration = 60;

export async function POST() {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }
  try {
    return NextResponse.json(await runRefresh());
  } catch (err) {
    console.error("news-desk: refresh failed", err);
    return NextResponse.json({ error: "refresh failed" }, { status: 500 });
  }
}
```

In `web/lib/route-gate.ts`, add `"/api/news-desk",` to `GATED_PREFIXES` after `"/api/newsletter",`.

- [ ] **Step 8: Run to verify pass**

Run: `cd /e/Personal/looper/web && npx vitest run app/api/news-desk lib/route-gate.test.ts lib/news-desk`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /e/Personal/looper/web && git add lib/news-desk/refresh.ts lib/news-desk/refresh.test.ts app/api/news-desk lib/route-gate.ts lib/route-gate.test.ts
git commit -m "feat(news-desk): add the gated refresh route

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 7: Page, headline list and tool registration

**Files:**
- Create: `web/lib/news-desk/format.ts`
- Test: `web/lib/news-desk/format.test.ts`
- Create: `web/components/news-desk/HeadlineList.tsx`
- Create: `web/components/news-desk/HeadlineList.stories.tsx`
- Create: `web/components/news-desk/NewsDesk.tsx`
- Test: `web/components/news-desk/NewsDesk.test.tsx`
- Create: `web/app/tools/news-desk/page.tsx`
- Test: `web/app/tools/news-desk/page.test.tsx`
- Modify: `web/lib/route-gate.ts` (`TOOLS`), `web/lib/route-gate.test.ts` (`toolNameFor` cases)
- Modify: `web/lib/site/commands.ts`, `web/lib/site/commands.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Headline`, `SourceError` types; `readSnapshot`, `isStorageConfigured`; `POST /api/news-desk/refresh`
- Produces:
  - `formatAge(iso: string, now: Date): string` — `"just now"`, `"5m ago"`, `"3h ago"`, `"2d ago"`
  - `<HeadlineList headlines={Headline[]} now={Date} />`
  - `<NewsDesk initial={Snapshot | null} problem={string | null} nowIso={string} />` (client; `nowIso` is the server's render time, so server and browser print the same ages)
  - Page at `/tools/news-desk`, `TOOLS` entry `{ href: "/tools/news-desk", name: "News Desk", kind: "News", blurb: … }`, command `open-news-desk`

- [ ] **Step 1: Write the failing `formatAge` tests**

`web/lib/news-desk/format.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatAge } from "./format";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("formatAge", () => {
  it.each([
    [ago(30_000), "just now"],
    [ago(5 * 60_000), "5m ago"],
    [ago(3 * 3_600_000), "3h ago"],
    [ago(2 * 86_400_000), "2d ago"],
    // A feed clock slightly ahead of ours is not "in the future".
    [new Date(NOW.getTime() + 60_000).toISOString(), "just now"],
  ])("%s → %s", (iso, expected) => {
    expect(formatAge(iso, NOW)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run, verify failure, implement, verify pass**

Run: `cd /e/Personal/looper/web && npx vitest run lib/news-desk/format.test.ts` → FAIL (missing module).

`web/lib/news-desk/format.ts`:

```ts
export function formatAge(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

Run again → PASS, 5 tests.

- [ ] **Step 3: Write the failing component tests**

`web/components/news-desk/NewsDesk.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NewsDesk } from "./NewsDesk";
import type { Snapshot } from "../../lib/news-desk/types";

const NOW = "2026-09-25T12:00:00.000Z";

const SNAPSHOT: Snapshot = {
  version: 1,
  refreshedAt: "2026-09-25T10:00:00.000Z",
  headlines: [
    {
      id: "a",
      title: "Moody's raises India FY27 GDP forecast to 7%",
      url: "https://news.google.com/rss/articles/a",
      source: "Reuters",
      publishedAt: "2026-09-25T09:00:00.000Z",
      direct: false,
    },
    {
      id: "b",
      title: "Cabinet to decide on new BIT template",
      url: "https://www.livemint.com/economy/bit",
      source: "Mint",
      summary: "New template aims to ease dispute settlement.",
      publishedAt: "2026-09-25T08:00:00.000Z",
      direct: true,
    },
  ],
  sourceErrors: [{ source: "SEBI", message: "timed out" }],
};

describe("NewsDesk", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists headlines newest first, linking out in a new tab", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Moody's raises India FY27 GDP forecast to 7%",
      "Cabinet to decide on new BIT template",
    ]);
    expect(links[1]).toHaveAttribute("href", "https://www.livemint.com/economy/bit");
    expect(links[1]).toHaveAttribute("target", "_blank");
    expect(links[1]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("New template aims to ease dispute settlement.")).toBeInTheDocument();
    expect(screen.getByText("Reuters · 3h ago")).toBeInTheDocument();
  });

  it("says when it last refreshed and which sources failed", () => {
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    expect(screen.getByText(/Refreshed 2h ago/)).toBeInTheDocument();
    expect(screen.getByText("1 source failed")).toBeInTheDocument();
    expect(screen.getByText("SEBI: timed out")).toBeInTheDocument();
  });

  it("shows an empty state before the first refresh", () => {
    render(<NewsDesk initial={null} problem={null} nowIso={NOW} />);
    expect(screen.getByText("Nothing saved yet. Press Refresh to fetch headlines.")).toBeInTheDocument();
  });

  it("shows the server's problem instead of a list", () => {
    render(<NewsDesk initial={null} problem="Could not read the saved headlines." nowIso={NOW} />);
    expect(screen.getByText("Could not read the saved headlines.")).toBeInTheDocument();
  });

  it("replaces the list with the refreshed snapshot, disabling the button meanwhile", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    render(<NewsDesk initial={null} problem={null} nowIso={NOW} />);

    const button = screen.getByRole("button", { name: "Refresh" });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledWith("/api/news-desk/refresh", { method: "POST" });

    resolve(new Response(JSON.stringify(SNAPSHOT), { status: 200 }));
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("keeps the current list and says why when a refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "storage not configured" }), { status: 503 })),
    );
    render(<NewsDesk initial={SNAPSHOT} problem={null} nowIso={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed: storage not configured"),
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd /e/Personal/looper/web && npx vitest run components/news-desk`
Expected: FAIL, cannot resolve `./NewsDesk`.

- [ ] **Step 5: Implement the components**

`web/components/news-desk/HeadlineList.tsx`:

```tsx
import { formatAge } from "../../lib/news-desk/format";
import type { Headline } from "../../lib/news-desk/types";

export function HeadlineList({ headlines, now }: { headlines: Headline[]; now: Date }) {
  return (
    <ul>
      {headlines.map((headline) => (
        <li key={headline.id} className="border-b border-rule py-3">
          <a
            href={headline.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.9375rem] font-semibold leading-snug text-fg hover:text-accent"
          >
            {headline.title}
          </a>
          {headline.summary && (
            <p className="mt-1 text-sm leading-relaxed text-muted">{headline.summary}</p>
          )}
          <p className="mt-1 text-xs text-muted">
            {headline.source} · {formatAge(headline.publishedAt, now)}
          </p>
        </li>
      ))}
    </ul>
  );
}
```

`web/components/news-desk/NewsDesk.tsx`:

```tsx
"use client";

import { useState } from "react";
import { formatAge } from "../../lib/news-desk/format";
import type { Snapshot } from "../../lib/news-desk/types";
import { HeadlineList } from "./HeadlineList";

export function NewsDesk({
  initial,
  problem,
  nowIso,
}: {
  initial: Snapshot | null;
  problem: string | null;
  nowIso: string;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ages are computed against the server's render time, never `new Date()` in
  // render: the server and the browser would print different "Nm ago" strings
  // and React would report a hydration mismatch. Updated only in the click
  // handler, which runs in the browser alone.
  const [now, setNow] = useState(() => new Date(nowIso));

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/news-desk/refresh", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(`Refresh failed: ${body?.error ?? `status ${res.status}`}`);
        return;
      }
      setSnapshot(body as Snapshot);
      setNow(new Date());
    } catch {
      setError("Refresh failed: network error");
    } finally {
      setRefreshing(false);
    }
  }

  const failed = snapshot?.sourceErrors ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
        <div className="text-xs text-muted">
          {snapshot ? <span>Refreshed {formatAge(snapshot.refreshedAt, now)}</span> : <span>Never refreshed</span>}
          {failed.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer">
                {failed.length} {failed.length === 1 ? "source" : "sources"} failed
              </summary>
              <ul className="mt-1">
                {failed.map((f) => (
                  <li key={f.source}>
                    {f.source}: {f.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="rounded-md border border-rule px-3 py-1.5 text-sm text-fg disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {error}
        </p>
      )}

      {problem ? (
        <p className="mt-6 text-sm text-muted">{problem}</p>
      ) : snapshot && snapshot.headlines.length > 0 ? (
        <HeadlineList headlines={snapshot.headlines} now={now} />
      ) : (
        <p className="mt-6 text-sm text-muted">Nothing saved yet. Press Refresh to fetch headlines.</p>
      )}
    </div>
  );
}
```

Before writing the classes, check the token names used by `web/components/newsletter/IssueList.tsx` (`border-rule`, `text-muted`, `text-fg`, `text-accent`) and match whatever that file actually uses; the theme tokens are defined in `web/app/globals.css`.

`web/components/news-desk/HeadlineList.stories.tsx` (same shape as `web/components/newsletter/IssueList.stories.tsx`; Chromatic snapshots it in light and dark):

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HeadlineList } from "./HeadlineList";
import type { Headline } from "../../lib/news-desk/types";

const meta = {
  title: "News Desk/HeadlineList",
  component: HeadlineList,
} satisfies Meta<typeof HeadlineList>;

export default meta;
type Story = StoryObj<typeof meta>;

const headlines: Headline[] = [
  {
    id: "a",
    title: "Moody's raises India FY27 GDP forecast to 7%",
    url: "https://example.com/a",
    source: "Reuters",
    publishedAt: "2026-09-25T09:00:00.000Z",
    direct: false,
  },
  {
    id: "b",
    title: "Cabinet to decide on new BIT template",
    url: "https://example.com/b",
    source: "Mint",
    summary: "New template aims to ease investor–state dispute settlement.",
    publishedAt: "2026-09-25T08:00:00.000Z",
    direct: true,
  },
];

export const Default: Story = {
  args: { headlines, now: new Date("2026-09-25T12:00:00.000Z") },
};
```

- [ ] **Step 6: Run to verify pass**

Run: `cd /e/Personal/looper/web && npx vitest run components/news-desk`
Expected: PASS, 6 tests.

- [ ] **Step 7: Write the failing page, registration and command tests**

`web/app/tools/news-desk/page.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/news-desk/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/news-desk/store")>("@/lib/news-desk/store");
  return { ...actual, readSnapshot: vi.fn() };
});

import { readSnapshot, SnapshotCorruptError } from "@/lib/news-desk/store";
import NewsDeskPage from "./page";

describe("News Desk page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_NAME = "audio-bucket";
  });

  it("renders the heading and the empty state before the first refresh", async () => {
    vi.mocked(readSnapshot).mockResolvedValue(null);
    render(await NewsDeskPage());
    expect(screen.getByRole("heading", { level: 1, name: "News Desk" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();
  });

  it("says storage is not configured instead of reading S3", async () => {
    delete process.env.S3_BUCKET_NAME;
    render(await NewsDeskPage());
    expect(screen.getByText(/Storage is not configured here/)).toBeInTheDocument();
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it("reports a read failure without crashing", async () => {
    vi.mocked(readSnapshot).mockRejectedValue(new SnapshotCorruptError("bad"));
    render(await NewsDeskPage());
    expect(screen.getByText(/Could not read the saved headlines/)).toBeInTheDocument();
  });
});
```

In `web/lib/route-gate.test.ts`, add to the `toolNameFor` `it.each` table, after `["/tools/newsletter-admin", "Newsletter admin"],`:

```ts
    ["/tools/news-desk", "News Desk"],
```

In `web/lib/site/commands.test.ts`:
- in the id list of the first test, insert `"open-news-desk",` after `"open-money-planner",`
- in the `it.each` of hrefs, add `["open-news-desk", "/tools/news-desk"],` after the money-planner row.

In `web/e2e/tools.spec.ts`, in "the hub links to every gated tool", add `["News Desk", "/tools/news-desk"],` after the Money Planner row.

- [ ] **Step 8: Run to verify failure**

Run: `cd /e/Personal/looper/web && npx vitest run app/tools/news-desk lib/route-gate.test.ts lib/site/commands.test.ts`
Expected: FAIL — page module missing, `toolNameFor("/tools/news-desk")` is `null`, command id missing.

- [ ] **Step 9: Implement the page and registrations**

`web/app/tools/news-desk/page.tsx` — the header markup is copied from `web/app/tools/newsletter-admin/page.tsx` so the tool pages match:

```tsx
import Link from "next/link";
import { CommandBar } from "../../../components/site/CommandBar";
import { NewsDesk } from "../../../components/news-desk/NewsDesk";
import { isStorageConfigured, readSnapshot } from "@/lib/news-desk/store";
import type { Snapshot } from "@/lib/news-desk/types";

export const dynamic = "force-dynamic";

export default async function NewsDeskPage() {
  let initial: Snapshot | null = null;
  let problem: string | null = null;

  if (!isStorageConfigured()) {
    problem = "Storage is not configured here (S3_BUCKET_NAME is unset), so nothing can be saved.";
  } else {
    try {
      initial = await readSnapshot();
    } catch (err) {
      // Logged, because an IAM change is otherwise indistinguishable from a
      // corrupt file on the page. A corrupt file is repaired by the next Refresh.
      console.error("news-desk: could not read the snapshot", err);
      problem = "Could not read the saved headlines. Refresh to try again.";
    }
  }

  return (
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg">
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">Tools / News Desk</span>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-5 py-14 sm:px-10">
        <div className="col-span-12 lg:col-span-8">
          <h1 className="font-display text-3xl leading-[1.15]">News Desk</h1>
          <p className="mt-4 mb-8 text-sm leading-relaxed text-muted">
            Indian economy, reforms and legislation, from 13 free sources. Refresh fetches
            everything again; nothing updates on its own.
          </p>
          <NewsDesk initial={initial} problem={problem} nowIso={new Date().toISOString()} />
        </div>
      </main>

      <CommandBar />
    </div>
  );
}
```

Check how `newsletter-admin/page.tsx` renders `CommandBar` (props, position) and match it exactly; if it passes props, pass the same.

In `web/lib/route-gate.ts`, add to `TOOLS` after the Money Planner entry:

```ts
  {
    href: "/tools/news-desk",
    name: "News Desk",
    kind: "News",
    blurb:
      "Headlines on the Indian economy, reforms and legislation from 13 free sources, refreshed when you ask.",
  },
```

In `web/lib/site/commands.ts`, after the `open-money-planner` command:

```ts
  {
    id: "open-news-desk",
    label: "open news-desk",
    hint: "Read economy, reform and legislation headlines",
    run: (ctx) => ctx.push("/tools/news-desk"),
  },
```

- [ ] **Step 10: Run the whole unit suite and lint**

Run: `cd /e/Personal/looper/web && npm test && npm run lint`
Expected: all tests pass (including `app/tools/page.test.tsx`, which iterates `TOOLS`), lint clean.

- [ ] **Step 11: Commit**

```bash
cd /e/Personal/looper/web && git add lib/news-desk/format.ts lib/news-desk/format.test.ts components/news-desk app/tools/news-desk lib/route-gate.ts lib/route-gate.test.ts lib/site/commands.ts lib/site/commands.test.ts e2e/tools.spec.ts
git commit -m "feat(news-desk): add the News Desk page with manual refresh

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 8: End-to-end check, docs and a live refresh

**Files:**
- Create: `web/e2e/news-desk.spec.ts`
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)
- Modify: `CLAUDE.md` (Structure → gated areas sentence)

- [ ] **Step 1: Write the e2e spec**

`web/e2e/news-desk.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("the News Desk is gated, reachable from the hub, and renders without storage", async ({ page }) => {
  await page.goto("/tools/news-desk");
  await expect(page).toHaveURL(/\/login\?next=%2Ftools%2Fnews-desk/);

  await page.getByLabel(/password/i).fill("test123");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/tools\/news-desk$/);

  await expect(page.getByRole("heading", { level: 1, name: "News Desk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("the refresh route is behind the gate", async ({ request }) => {
  const res = await request.post("/api/news-desk/refresh", { maxRedirects: 0 });
  expect([307, 401]).toContain(res.status());
});
```

Before running, check what `web/proxy.ts` returns for an unauthenticated `/api/...` request (a redirect to `/login` or a 401) and narrow the second assertion to that one status.

- [ ] **Step 2: Run the e2e suite**

Run: `cd /e/Personal/looper/web && npm run test:e2e -- news-desk.spec.ts tools.spec.ts`
Expected: PASS. (Needs `npx playwright install chromium` once.)

- [ ] **Step 3: Update docs**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, add as the first bullet:

```markdown
- News Desk tool at `/tools/news-desk`: headlines on the Indian economy, reforms and legislation from 13 free RSS sources (FT, RBI, SEBI, Mint, Business Standard directly; Reuters, Bloomberg, The Economist, PRS and PIB through Google News), refreshed only when you press Refresh. Items older than 14 days are dropped and duplicates across sources are merged. Topic tags, MoSPI indicators and the chat assistant follow in later phases (#253).
```

In `CLAUDE.md`, in the Structure bullet for `web/`, change `the `/api/looper/*`, `/api/resume/*` and `/api/newsletter/*` routes` to `the `/api/looper/*`, `/api/resume/*`, `/api/newsletter/*` and `/api/news-desk/*` routes`, and add `News Desk` to the list of tools in the same sentence (`… newsletter admin, Money Planner, News Desk)`).

In `.claude/rules/web.md`, the bullet beginning "Only `/tools`, `/api/looper/*`, `/api/resume/*`, `/keystatic`, and `/api/keystatic/*` require the shared password" is already missing `/api/newsletter/*`. Change that list to "`/tools`, `/api/looper/*`, `/api/resume/*`, `/api/newsletter/*`, `/api/news-desk/*`, `/keystatic`, and `/api/keystatic/*`", and leave the rest of the bullet as it is. Add `.claude/rules/web.md` to this step's `git add`.

- [ ] **Step 4: Live refresh against real feeds (manual, local)**

With AWS credentials for the `personal` profile available and the Task 1 Terraform applied, run the dev server against the dev bucket and press Refresh once:

```bash
cd /e/Personal/looper/web && AWS_PROFILE=personal APP_AWS_REGION=us-east-1 S3_BUCKET_NAME=bgm-looper-audio-dev-223376380711 APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev
```

Log in at `http://localhost:3000/login`, open `/tools/news-desk`, press Refresh. Expected: roughly 300–600 headlines, 0–2 failed sources, finishing in under 10 s. Record the count, the failures and the duration in the PR description. If more than two sources fail, investigate before opening the PR.

Local static credentials can do more than the Vercel role, so this does not test IAM. The IAM check happens on the dev deployment after merge: Refresh there must succeed, and the first page load before any refresh must show the empty state, not "Could not read".

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper && git add web/e2e/news-desk.spec.ts CHANGELOG.md CLAUDE.md .claude/rules/web.md
git commit -m "docs(news-desk): changelog, gated routes, e2e reachability

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

- [ ] **Step 6: Apply Terraform, confirm the plan is clean, open the PR**

Ask the owner to approve the apply, then:

```bash
cd /e/Personal/looper/infra/main && terraform apply -var-file=terraform.tfvars && terraform plan -var-file=terraform.tfvars -no-color | tail -3
```

Expected after apply: `No changes. Your infrastructure matches the configuration.` That is the merge gate for `infra/` changes (CLAUDE.md "Merging a PR").

Then open the PR into `dev`. The body starts with `Closes #<Phase 1 issue>` and `Part of #253`, and records: the apply, the clean plan, and the live refresh numbers from Step 4. Before merging, follow the `merging-a-pr` skill end to end.

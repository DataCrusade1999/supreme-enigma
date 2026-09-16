# Portfolio Site — Research Plan

Date: 2026-09-15
Subject: the public portfolio at https://bgm-looper.vercel.app (`app/app/(site)/`)
Status: planned, not yet run

## 1. Why now

The editorial redesign (phase 5) is live on all three branches. It was
settled on a design canvas against the author's own taste; nobody outside
the project has been watched using it.

One specific thing prompted this plan. The site's two loudest calls to
action both lead to a password wall. `FeaturedTool` on the home page is a
3.5rem serif "BGM Looper", badged **Live**, with a filled "Open the tool →"
bar; `SiteHeader` carries a second filled "BGM Looper" button, sticky, on
every page including `/resume` and `/contact`. Both point at
`/tools/bgm-looper`, which `app/lib/route-gate.ts` gates behind the shared
password. So every anonymous visitor who acts on the site's loudest
instruction lands on `/login`, and the invitation to do so follows them
around the site. There is no fallback: `Project.demoGif` is unset for
`bgm-looper`, so the detail page omits the demo section and nothing on the
public site shows the tool working.

That may be fine — a private tool, plainly private. It may also read as
broken, or as a candidate who put a password on their own portfolio. The
difference is worth 6 sessions.

## 2. Objectives

Six hypotheses, each with the bar that decides it. Phrased so a session
can falsify them.

| # | Hypothesis | Bar |
|---|---|---|
| H1 | Hitting `/login` from "Open the tool" reads as *private by design*, not as broken or unfinished | ≥4/6 describe it as intentional/private **unprompted**, before the moderator uses the word "password" |
| H2 | The home page answers "who is this and what is this site" in 5 seconds | ≥5/6 say "software engineer" or equivalent, and name the tool, from a 5-second exposure |
| H3 | The pipeline-settings table (−14.0 LUFS, 50 ms, top_db 40) and the waveform caption read as credible specificity, not as noise | ≥4/6 call it a signal of depth; **0** call it showing off or confusing |
| H4 | A recruiter can get the resume without help | 6/6 reach `/resume` and download the PDF in ≤60s, no moderator prompt |
| H5 | A contact path is findable | 6/6 reach `/contact` or name an alternative route unprompted |
| H6 | The sparse, ruled, un-carded layout reads as confident rather than empty or unfinished | ≥4/6 use positive or neutral language for the whitespace; no one asks whether the page failed to load |

H1 is the reason the study exists. If the other five come back clean and H1
fails, the study paid for itself.

## 3. Method

**Moderated remote usability test with an interview wrapper**, 40 minutes,
think-aloud, screen shared, recorded with consent.

Why this and not the alternatives:

- **Not a survey.** n≈6 is what is reachable here, and the H1 question is
  about a reaction in the moment, not a stated preference.
- **Not unmoderated** (Maze/UserTesting). The single most valuable moment
  is the pause at `/login`, and it needs a live, non-leading probe.
- **Not a 5-second test alone.** It answers H2 and nothing else. It is
  folded in as the first task instead.

**Environment:** production, `https://bgm-looper.vercel.app`. The public
site is identical on `dev` and `main` as of this date (`git diff
origin/main -- 'app/app/(site)' app/components/site` is empty), so there is
no reason to send participants to a preview URL.

Desktop sessions. Mobile is a separate study — the 12-column grid collapses
and the hero drops to `4.125rem`, and mixing viewports across 6 people
gives no clean read on either.

## 4. Participants

Six, two per segment.

| Segment | Screener | Why |
|---|---|---|
| Recruiter / talent partner | Screens engineering candidates; has opened a candidate's personal site in the last 3 months | Scans, does not read. Owns H4. |
| Hiring engineering manager | Has made or influenced an eng hire in the last 12 months | Judges the work, not the layout. Owns H1 and H3. |
| Peer software engineer | Builds things; **not** an audio/DSP person | Reads the craft signals. Owns H3 and H6. |

Deliberately excluded: anyone with audio/DSP background (H3 is about
whether the numbers land on people who cannot evaluate them), and anyone
who has already seen the site or the design canvas.

**Recruiting is the hard part and there is no panel budget.** Realistic
sources, in order: the author's own network for the two engineers; LinkedIn
outreach to recruiters who have previously reached out to the author (they
have a
standing reason to reply); one hiring manager via a warm intro. Incentive:
none offered, ask framed as a 40-minute favour with the finding shared
back. Expect roughly 3 asks per accepted session — send ~18.

If a segment cannot be filled, run five and say which segment is missing in
the report. Do not backfill a recruiter with an engineer.

## 5. Out of scope

- Redesigning the login gate. This study measures what the gate costs; what
  to do about it is a separate decision.
- BGM Looper's own usability (upload → process → download). The tool is
  behind the gate; testing it needs its own study with its own participants.
- The admin tools (`/tools/resume-admin`, newsletter admin, Keystatic).
  Single user, who is the author.
- Mobile and tablet viewports.
- Accessibility audit. Overlaps, but it is an expert review, not user
  research — `design:accessibility-review` covers it.

## 6. Analysis

Affinity map every observation onto H1–H6; anything that fits none goes in
an "unallocated" pile and is read last — that pile is where the question we
did not think to ask usually is.

Per task, record completion as **unaided / aided / failed** plus one verbatim
quote. H4 and H5 are pass/fail on that column alone. H1, H3 and H6 are read
from quotes, and each needs two independent supporting quotes before it is
called.

Then an impact/effort matrix over whatever needs fixing, and a short
highlight reel — the `/login` moment from each of the six sessions cut back
to back, which will make the H1 verdict self-evident to anyone who watches
it.

## 7. Timeline

| Week | Work |
|---|---|
| 1 | Finish the guide, pilot with one throwaway participant, send outreach |
| 2 | Sessions 1–6, notes written up within 2h of each |
| 3 | Affinity map, report, highlight reel; file issues for what survives |

## 8. Pre-session checks

Run these the day before the first session. Each one, if wrong, invalidates
a task in the guide.

1. **`/resume` shows the Download PDF button.** It is gated on
   `pdfPublished`, not on `published` — if the production publish has not
   happened, the button is absent and task 5 has no target. Open
   `https://bgm-looper.vercel.app/resume` and look.
2. **`/blog` and `/newsletter` have at least one real entry each.** An empty
   list contaminates H6 — participants will read "unfinished site" off the
   emptiness, not off the design.
3. **`/login` rate limiting does not lock a participant out.** Sessions will
   generate repeated hits from a small set of IPs; confirm the edge limit
   from `f07f784` will not trip mid-session.
4. **Both themes.** Decide one and hold it constant — the theme toggle
   changes the entire visual argument, and 6 sessions cannot answer H6 for
   two designs. Default to whatever a first-time visitor gets.

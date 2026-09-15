# Portfolio Site — Moderator Guide

Companion to `2026-09-15-portfolio-site-research-plan.md`. 40 minutes.
Hypotheses referenced as H1–H6 from §2 of the plan.

Bracketed text is a moderator instruction, never read aloud. Everything
else is script — say it close to verbatim, especially the probes, because
the wording is what keeps them non-leading.

**Set up before the participant joins:** task 0 runs on *your* screen, and
everything after it runs on *theirs*. So: the home page loaded in a tab you
can switch away from, `https://bgm-looper.vercel.app` pasted into the
meeting chat ready to send, recording armed, and this sheet's observation
table open beside you.

---

## 1. Warm-up — 5 min

> Thanks for making time. This will take about forty minutes.
>
> I'm going to show you a personal website that belongs to a software
> engineer, and ask you to do a few things on it while talking out loud —
> what you're looking at, what you expect to happen, what you're thinking
> even if it seems obvious or unkind. The unfiltered version is the useful
> one.
>
> Two things worth saying plainly. The site is what's being tested, not you
> — if something is confusing, that's the site's problem and exactly what
> I'm here to find. And I didn't design it, so you can't hurt my feelings.

[That last line only if it is true for you. If the author is moderating,
replace it with: "I built it, and I've asked you here because I can't see
it fresh anymore — flattering answers are the one thing that would waste
both our time."]

> Can I record the screen and audio? It's for my notes and won't go
> anywhere else. You can ask me to stop at any point.

[Get an explicit yes. Start recording. State the date and participant code
on the recording.]

---

## 2. Context — 7 min

Do not show the site yet. These answers are the baseline the rest is read
against.

1. Tell me about your role, and how often you end up looking at an
   individual engineer's personal website.
2. Think of the last one you opened. What made you open it?
3. When you land on one, what are you actually trying to find out?
4. How long do you usually give it before you decide it's worth more time?
5. [Recruiters] Walk me through what you do with what you find — where does
   it go, who else sees it?
   [Hiring managers and engineers] What on a personal site has ever made you
   think better of someone? What has made you think worse?

[Listen for whether "can I see the work" or "can I see the resume" comes
first. It predicts which task they will fail.]

---

## 3. Deep dive — 18 min

### Task 0 — five-second test (H2) · 1 min

> I'm going to show you the home page for five seconds, then hide it. Don't
> try to read everything, just look.

[Share *your* screen, show the home page, five seconds, stop sharing. Do
not let them load it themselves — the whole task is the exposure being
exactly five seconds.]

- Who is this person?
- What is this site for?
- What do you remember seeing?

[Record their exact words for "who". H2 passes on "software engineer" or
equivalent **and** naming the tool. Note which of the two landed first.]

### Task 1 — open-ended first pass (H2, H6) · 3 min

> Now you drive. I've put the link in the chat — open it and share your
> screen.

[Wait until you can see their screen. Everything from here to the end of
the deep dive is on their machine, so you are watching real scrolling, real
hesitation and real clicks.]

> Here it is again, take as long as you want. Talk me through what you're
> seeing.

[Hands off. Do not answer questions yet — "what would you do if I weren't
here?" Let them scroll. Note whether they touch the waveform figure or the
settings table, or scroll straight past both.]

Probes, only if they go quiet:

- What's your read on this so far?
- Is there anything here you're not sure about?

### Task 2 — the featured tool (H1) · 5 min

**This is the task the study exists for. Do not rush it and do not rescue
them.**

> Say you wanted to actually try the thing this page is showing off. Go
> ahead.

[They click "Open the tool" or the header button. They land on `/login`.
Stop talking. Let the silence run — the first unprompted reaction is the
data. Then ask these in order, and stop as soon as they answer:]

1. What just happened?
2. What do you think this is?
3. What would you do next?
4. [Only if they have not raised it themselves] Does this change anything
   about how you read the rest of the site?

**Do not say "password", "login", "private", "gate" or "broken" until they
have.** Write down which word they reach for first. That word is the H1
verdict.

[Then, and only after all four:]

5. The page you came from called this tool "Live". Knowing what you know
   now, what does "Live" mean to you there?

### Task 3 — how it works (H3) · 3 min

> Without getting into the tool itself — can you find out how it works?

[Target is `/projects/bgm-looper`, reachable from "How it works" on the home
page or through Projects. Note the route they take.]

Once they are there, or back at the home page's settings table:

- There are some numbers on here — minus fourteen LUFS, fifty milliseconds,
  top_db forty. What do you make of those?
- Does seeing those make you more or less confident about this person? Say
  more.

[H3 fails on any answer in the family of "showing off", "means nothing to
me", "I skipped it". It passes on "they know what they're doing" or "those are
real settings". Record verbatim — this is the one that is easy to score
generously by accident.]

### Task 4 — the resume (H4) · 3 min

> You've decided this is someone worth a closer look. Get me their resume.

[Silent timer from the end of that sentence. Stop it when the PDF download
starts or the resume is on screen. 60s is the bar. Mark it aided the moment
you say anything at all.]

- Is this what you expected to get?
- [Recruiters] Is this usable for you as-is?

### Task 5 — contact (H5) · 2 min

> Last one. You want to reach them. Show me how.

[Note whether they use the nav, scroll for a footer, or say "I'd just
message them on LinkedIn". That last one is a valid pass, but record it as
such — it means the site's own contact page did no work.]

### Task 6 — anything missing (H6) · 1 min

> Anything you expected to find on a site like this that isn't here?

---

## 4. Reaction — 7 min

There is no prototype to show. The thing worth showing is the tool the gate
hid.

> Earlier you hit that password screen. I have the password — let me show
> you what's behind it.

[Take screen sharing back. Log in on your own machine — never ask them to
type a password you gave them. Run one real track through BGM Looper end to end:
upload, process, play the looped result. Say nothing while it runs. Have a
short track pre-picked and pre-tested — do not discover a slow Lambda cold
start in front of a participant.]

- Now that you've seen it, does that change your read of this person?
- Does it change your read of the site?
- If you had hit that password screen on your own, with no one to let you
  in, what would you have concluded?
- What would you have wanted the site to show you instead?

[The gap between their answer before and after is the cost of the gate,
stated in their own words. That is the finding. Do not lead them toward
"it should have had a demo video" — if they propose it, good, and if three
of six propose it unprompted, that is a recommendation with evidence behind
it.]

---

## 5. Wrap-up — 3 min

- Anything I should have asked you about and didn't?
- If you could change one thing about this site, what would it be?

> That's everything. This was genuinely useful — the password question in
> particular is the one I couldn't answer from the inside. Thank you.

[Stop recording. Write your notes now, before the next thing. Not tonight.]

---

## Observation sheet

One per participant. Fill it in during the session, not after.

Participant: ____  Segment: ____  Date: ____  Theme shown: light / dark

| Task | Outcome | Quote |
|---|---|---|
| 0 · five-second (H2) | said role: Y / N · named tool: Y / N | |
| 1 · first pass (H6) | confident / empty / unfinished | |
| 2 · **login wall (H1)** | first word used: ________ · read as: intentional / broken / unsure | |
| 3 · the numbers (H3) | depth / noise / skipped | |
| 4 · resume (H4) | unaided / aided / failed · ____ s | |
| 5 · contact (H5) | unaided / aided / failed · route: ________ | |
| 6 · missing | | |
| Reaction · after seeing the tool | improved / unchanged / worsened | |

Unallocated — anything that fit none of H1–H6:

---

## Pilot first

Run this once with someone disposable before session 1. The pilot is
checking the guide, not the site:

- Does task 2 produce a reaction, or does the participant treat the login
  page as a non-event and move on? If they shrug, the probe order is wrong.
- Does the deep dive fit in 18 minutes? It will overrun. Task 3 is the one
  to cut.
- Does the reaction demo run fast enough to hold attention? If the Lambda
  cold start leaves dead air, pre-warm it right before each session.

Do not count the pilot as a participant.

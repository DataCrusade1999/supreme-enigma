# Portfolio Site — Design Critique

Date: 2026-09-15
Scope: the seven public pages of `app/app/(site)/`, checked against
production (`https://bgm-looper.vercel.app`), not the local tree
Companion to `2026-09-15-portfolio-site-research-plan.md`

Nothing in this document has been fixed or filed.

## Overall

The design system is good — disciplined, consistent, and tested in CI in
ways most personal sites are not. The problem is not the design.

**Four of the seven nav destinations are scaffold or broken in
production.** The frame is finished; much of the picture is missing, and
the nav promises a body of work that is not behind it.

| Nav item | State in production |
|---|---|
| Home | Real |
| About | Four bracketed placeholders beside real resume copy |
| Projects | Real, one row |
| Resume | Real, PDF published |
| Blog | One scaffold stub naming Keystatic |
| Newsletter | One scaffold stub naming Keystatic |
| Contact | Real email; GitHub and LinkedIn are dead links |

## Usability

| Finding | Severity | Recommendation |
|---|---|---|
| `/contact` — GitHub and LinkedIn point at `github.com/your-username` and `linkedin.com/in/your-username`, live now | Critical | Real URLs. `contact/page.test.tsx:14` *pins* the placeholders ("keeps the your-username placeholders exactly as they are") — update that expectation, do not delete the test. Recruiters click precisely these two links. |
| `/blog` and `/newsletter` each hold one stub whose body reads "edit or delete this post any time from /keystatic" | Critical | Worse than empty: it names the CMS and tells a visitor they are looking at an unconfigured template. Replace the content, or unlist the pages until there is a post. |
| `/about` — `[City, Country]`, `[What you are working on]`, `[Your stack]`, `[A second paragraph: how you got here, and what you are looking for next.]` | Critical | These sit beside the *published* resume headline, so genuine and scaffold copy interleave in one column. That is the worst arrangement — it makes the real content look unfinished too. |
| Both primary CTAs (`FeaturedTool`, and the sticky header button on every page) lead to `/login`, with no `demoGif` fallback | Moderate | A deliberate decision, and the research plan exists to test it, so not Critical. Cheapest mitigation that does not require settling the gate question: fill the `Project.demoGif` slot that already exists. |
| `/projects` metadata column renders the raw `project.href` — `/tools/bgm-looper` | Minor | A URL path where a year, stack or status belongs. The developer's view leaking into the visitor's. |

**Cause, stated precisely.** Spec §8 of the editorial redesign ("Content
that stays bracketed") deferred all of this on purpose: *"Writing that
content is separate work and is not part of this phase."* That was a
reasonable call at design time. The gap is that the phase then shipped to
production and no open issue tracks the follow-up — checked against all 14
open issues on 2026-09-15.

## Visual hierarchy

- **Eye lands first** on the 6.5rem serif name, then the 3.5rem "BGM
  Looper" beside it, then the waveform. That order is correct: identity,
  then proof, then texture.
- **Reading flow.** The 12-column grid with visible rules does real work.
  Title left, content in 3–8, metadata in 9–12, held on every page. The eye
  learns it once and then it is free.
- **Emphasis is right, the target is wrong.** The most emphasized
  interactive element on the site leads to a password wall. The hierarchy
  is doing its job perfectly and pointing at a locked door.
- **`/projects` is apparatus without cargo.** A 5.25rem masthead, the
  eyebrow "Index", and a row numbered `01` — for one project. The layout is
  sized for ten. Either that is a deliberate bet on future content, or the
  numbering is premature and should wait for the third project.

## Consistency

The strongest dimension, with little to say, which is the point.

The row pattern — stretched anchor, 10% accent wash wiping in from the
left, chevron translate, 3px hover indent, all on one 200ms ease-out — is
shared verbatim across `/projects`, `/blog` and `/contact`. `PageMasthead`
fronts every page except home, where the name is the masthead, deliberately
and with a comment saying so. Two faces, two sizes, no third of either. Two
motion clocks: 9s linear for anything that loops, 140–200ms for anything a
pointer touches.

No drift found.

## Accessibility

Better than most production sites, and the good parts are enforced rather
than hoped for.

**Contrast**, computed for both themes:

| Pair | Light | Dark |
|---|---|---|
| ink on ground | 15.71 | 15.47 |
| muted on ground | 5.48 | 6.30 |
| accent on ground | 5.27 | 9.30 |
| peak on ground | 5.41 | 5.05 |
| CTA text on ink fill | 15.71 | 15.47 |
| CTA text on accent hover fill | 5.27 | 9.30 |

All pass AA for normal text, including the 11px uppercase labels.
`lib/portfolio-tokens.test.ts` asserts every one of these in CI. That is
rare, and it is why there is nothing to report here.

- **Touch targets:** `min-h-11` (44px) on every link read, including the
  inline ones where it is easy to skip.
- **Motion:** `motion-reduce:` on every transition, not only the looping
  ones.
- **Focus:** a real `:focus-visible` outline, 2px accent at 2px offset.
- **Alt text:** no `<img>` on any public page — the waveform is spans, all
  `aria-hidden`. No debt.
- **Hairlines** sit at 1.34:1 (light) and 1.52:1 (dark). Below 3:1, but
  decorative separators are exempt from 1.4.11. Not a finding.
- **Unverified — the mobile header.** Seven 11px uppercase links at 0.16em
  tracking, plus divider, theme toggle and the filled button, in a
  `flex-wrap` nav inside ~335px of usable width at 375px. The labels alone
  total roughly 346px before gaps; with `gap-x-4` and the two controls the
  row approaches 590px, implying two or three wrapped rows in a sticky
  header. That is arithmetic, not a measurement — check it on a real 375px
  viewport before acting on it.

## What works well

- **The contrast tests.** Encoding the palette's accessibility as
  assertions means the design system cannot silently regress. The one place
  light-mode teal would have failed (terminal chrome, ~3.6:1) is documented
  *and* asserted as a negative test.
- **The home page's specificity.** −14.0 LUFS, 50 ms, top_db 40, quoted
  from the deployed pipeline with the source file named in a comment. Most
  portfolios say "I care about quality"; this shows three numbers it would
  be embarrassing to get wrong.
- **The waveform caption earns its animation.** It explains the product
  thesis — the tail already is the head — rather than decorating.
- **Rules instead of cards is a real position, held consistently.** No
  border radius anywhere, one fill.

## Priority recommendations

1. **Fix the four content holes before anything else.** Contact links,
   About's four brackets, the two Keystatic stubs. Roughly an afternoon, no
   design work, and it moves the site from "a template someone is still
   setting up" to "finished". Every other item here is worth less than this
   one.
2. **Give the tool a demo on the public side.** Fill `Project.demoGif` for
   `bgm-looper`. It is the cheapest thing that blunts the locked-door
   problem without settling the gate question, and it holds whichever way
   that research comes out.
3. **Fix the `/projects` metadata column.** Replace the raw href with
   something a visitor can use — year, stack or status. Small, but it is
   the one place the developer's mental model is visibly showing through.

## Effect on the research plan

Pre-session check #2 in `2026-09-15-portfolio-site-research-plan.md` asks
for "at least one real entry" on `/blog` and `/newsletter`. Each has one
*scaffold* entry, which is worse than empty for this purpose.

Run the study as written and H6 measures the placeholder copy, not the
design — participants will say "unfinished" and they will be right, for
reasons that have nothing to do with the layout being tested. H5 has the
same problem one level down: it passes on reaching `/contact`, but a
participant who then clicks LinkedIn hits a dead link, and that reaction
contaminates the design read.

Fix the content first, or the sessions confirm what this document already
found.

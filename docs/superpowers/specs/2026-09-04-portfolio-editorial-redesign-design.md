# Portfolio Editorial Redesign (UI Overhaul Phase 5) — Design Spec

Date: 2026-09-04

## 1. Purpose

Replaces the public portfolio's visual design. The current site is a
narrow (768px) mono-set column on a graphite ground with terminal
chrome; this phase moves it to a paper-first editorial system — a
serif display face on a visible 12-column grid, ruled rather than
carded — and adds the `/projects/[slug]` detail page that phase 4's
spec asks for.

The design was settled on a canvas, not in code: three directions were
drawn (editorial index / instrument panel / grid-and-weight), the third
was chosen, and it was then set twice — once in Archivo Black, once in
Instrument Serif — before the serif setting was locked. Every page,
both modes, the motion rules and the discarded rounds are on that
canvas; it is the visual source of truth this spec describes in words:

> **Design canvas:** https://claude.ai/code/artifact/7908c3d9-eae6-47bd-9608-2d48613509d8
> (pages: Light / Dark / Motion / Explorations)

**Relationship to the other UI-overhaul phases:**

- **Phase 1 (color tokens)** — extended, not replaced. The token
  *structure* (light in `@theme`, dark in `:root.dark`, both declared
  in full) is kept exactly; the values change.
- **Phase 2 (terminal layer)** — partly superseded. `/projects` stops
  using `TerminalWindow`. The component itself **stays**: `CommandBar`
  renders it, and that is unaffected by this phase.
- **Phase 3 (3D hero)** — **shelved, not implemented.** See §10.
- **Phase 4 (motion & GIFs)** — absorbed. `/projects/[slug]`,
  `ProjectDemoGif`, `Project.demoGif`, the row chevron and the
  theme-toggle icon land here, in this design's vocabulary. Two
  deviations from that spec are recorded in §10.

## 2. The system

Five decisions govern every page; anything not listed is derived from
them.

**Ground and ink.** Light: ground `#eceae5`, ink `#111110`, muted
`#5f5d57`, accent `#146b64`, peak `#a8362a`. Dark: ground `#131311`,
ink `#eceae5`, muted `#9a968c`, accent `#5ec8c0`, peak `#e2574c`.
Hairlines are the ink at 14% (light) / 16% (dark).

The dark ground is a **warm** near-black, not the current cool
`#0b0b0d` — the paper it answers to is warm, and a cool ground under
this serif reads as two designs stapled together. The accent pair is
the one the site already has: `#146b64` is unreadable on dark ground,
`#5ec8c0` is what dark mode already uses.

**Two faces, two sizes.** Instrument Serif for anything display
(page titles, project and post names, pull sentences); IBM Plex Sans
for everything else, at 12px / 0.14em / uppercase for labels and
metadata, 15–16px for body copy. No third face, no third size ramp.

**One grid.** 12 columns, 24px gutters, 40px page margins, on every
page, with the column rules visible at 14% ink. Page title left,
content in columns 3–8, metadata in 9–12. Prose is capped by column
span, not by a max-width on the text.

**Rules, not cards.** 2px under the header, the page title and the
footer; 1px between list rows. Nothing has a border radius, no element
has a fill except the primary action bar and the row hover wash.

**Two clocks.** 9s linear infinite for anything that loops; 140–200ms
ease-out for anything a pointer touches. §6.

## 3. Architecture

```
app/app/globals.css                    ← modified: new token values, motion keyframes
app/app/layout.tsx                       ← modified: next/font faces on <html>

app/components/site/
  PageMasthead.tsx                      ← new: eyebrow + serif title + 2px rule + optional right slot
  GridBackdrop.tsx                       ← new: the 12 visible column rules
  LoopRing.tsx                            ← new: the About mark (§5)
  ProjectDemoGif.tsx                       ← new: phase 4's <img> wrapper, priority-aware
  SiteHeader.tsx                            ← modified: icon toggle, ⌘K, grid alignment
  SiteFooter.tsx                             ← modified: ruled, stack list, centred copyright on mobile
  ThemeToggle.tsx                             ← modified: sun/moon icon, aria-label states

app/app/(site)/
  layout.tsx                              ← modified: container 768px → 12-col grid at 40px margins
  page.tsx                                 ← modified: hero, spec table, waveform, action bar
  about/page.tsx                            ← modified: two-column, LoopRing replaces the photo slot
  projects/page.tsx                          ← modified: ruled rows + chevron, link to [slug]
  projects/[slug]/page.tsx                    ← new: detail page (§4)
  resume/page.tsx                              ← modified: dates / role / bullets across the grid
  blog/page.tsx, components/blog/BlogList.tsx    ← modified: same row rhythm as projects
  contact/page.tsx                                ← modified: ruled rows

app/content/projects.ts                 ← modified: Project gains demoGif?: string
```

`TerminalWindow.tsx` and its test are **not** touched and **not**
deleted — `CommandBar` still renders it.

## 4. Pages

Every page opens with the same masthead — eyebrow (12px uppercase),
serif title at 84px, 2px rule beneath, an optional right-hand slot for
one action.

- **Home.** Eyebrow, name at 148px over two lines, lede in columns
  1–5, the pipeline settings as a 3-row table in 8–12, the waveform
  full width above a 2px baseline with head/tail called out, and the
  action bar. No masthead — the name is the masthead.
- **Projects.** Ruled rows: index number, serif name, description
  (max 46ch), metadata in 9–11, chevron in 12. Rows link to the detail
  page, not the tool.
- **Project detail** (`/projects/[slug]`, new). Back-to-index link,
  masthead with the project name and an "Open the tool" bar in the
  right slot, the demo GIF at 16:9 across columns 1–8, "built with" and
  "settings" in 10–12, then the description in 1–5 beside a numbered
  four-step list in 7–12. The steps are the real pipeline order from
  `lambda/src/looper/pipeline.py`: trim at `top_db` 40 → normalize to
  −14.0 LUFS → beat-aligned loop point → 50ms equal-power crossfade.
- **About.** A display-face opening sentence, two body paragraphs,
  `LoopRing` in columns 8–12 above a small metadata list.
- **Resume.** Dates in 1–2 (accent, tabular), role and org in 3–8,
  bullets in 9–12, 1px between entries.
- **Blog.** Date in 1–2, serif title and summary in 3–9, tags right in
  10–12.
- **Contact.** Ruled rows: label in 1–2, value at 34px serif in 3–10,
  arrow in 11–12.
- **Mobile (<768px).** Grid collapses to one column, 20px margins;
  the name drops to 66px; the nav wraps under the brand row; the
  footer's stack becomes a wrapping list with the copyright centred
  beneath a hairline.

## 5. LoopRing

The About page's right-hand column is not a portrait. It is the home
page's own bar envelope (`HEAD` + `BODY` + `HEAD`, the array already in
`app/(site)/page.tsx`) wrapped into a circle: bar *i* placed at
`-90° + i × (360/n)`, so index 0 sits at twelve o'clock and the
sequence closes onto its own start. Because the same eight values open
and close the array, the bars either side of twelve o'clock are
identical by construction — the ring *shows* the claim the home page's
caption makes, rather than asserting it.

Head and tail bars take the accent, peaks take the peak colour, the
rest take the ink — the same rules as the linear figure. It is ~60
absolutely-positioned spans; no image asset, no canvas, no dependency.

The envelope array must therefore be shared, not duplicated: it moves
to a module both the home page and `LoopRing` import.

## 6. Motion

**Loop clock — 9s linear infinite.** The value already in
`globals.css` for `.playhead`, reused so the ring and the waveform stay
in phase when both are on screen. Linear is a requirement, not a
default: easing slows the playhead at the wrap, which is exactly where
a loop must not slow down.

- **Ring:** a hairline hand sweeps once per loop, and a "Tail → head"
  mark appears for ~3% of the cycle as the wrap passes twelve o'clock.
  That mark is the only accent event. (A brighter variant — a teal hand
  with a leading dot — was drawn and rejected: more arresting on first
  sight, more tiring on the fifth visit.)
- **Waveform:** bars rise from the baseline on load, 560ms, 8ms apart,
  left to right — **once per page load, never on scroll**. The played
  region carries a 10% accent tint that resets at the wrap.

**Interaction clock — 140–200ms ease-out**, matching the existing
`.commandbar-fade-in`. Nav underline wipes in from the left on
`scaleX` (not an SVG `stroke-dashoffset` as phase 4 proposed — same
read, no per-link SVG). List rows indent 12px while a 10% accent wash
wipes across and the chevron slides 8px, all on one curve. The action
bar goes ink → accent and its arrow moves 8px. Inline links only warm
their underline. Nothing bounces or overshoots.

**`prefers-reduced-motion: reduce`** stops all of it, the same switch
`globals.css` already honours for `.playhead`: the hand parks, the
seam mark stays visible, bars stand at full height, the tint is absent,
hovers become instant state changes.

## 7. Fonts

`next/font/google` for both faces — self-hosted at build time, so no
render-blocking request to `fonts.googleapis.com` and no layout shift
class of bug that a raw `<link>` invites. Both are exposed as CSS
variables on `<html>` and consumed by the `--font-display` /
`--font-ui` tokens; the existing `--font-mono` / `--font-sans` tokens
are replaced, not kept alongside.

Fallbacks are metric-adjacent on purpose: `Georgia, 'Times New Roman',
serif` behind Instrument Serif, and the current system sans stack
behind IBM Plex Sans.

## 8. Content that stays bracketed

The design ships with visible placeholders rather than invented
content, because the repo's own content files are still the scaffold's:

- `content/resume.ts` — one placeholder entry (`"Add your most recent
  role here"`). Rendered as-is; the page must look right with it.
- `content/blog` — one real post (`hello-world.mdx`).
- `/about` — placeholder paragraphs.
- `/contact` — the real email; GitHub and LinkedIn are still
  `your-username` in `contact/page.tsx` and stay that way.
- `demoGif` — unset on `bgm-looper`. The detail page renders correctly
  without it; the section is omitted, not stubbed.

Writing that content is separate work and is **not** part of this
phase.

## 9. Accessibility

All token pairs clear WCAG AA (4.5:1) for normal text, verified with
the repo's own `contrastRatio` helper:

| Pair | Light | Dark |
| --- | --- | --- |
| ink on ground | 15.71 | 15.47 |
| muted on ground | 5.48 | 6.30 |
| accent on ground | 5.27 | 9.30 |
| peak on ground | 5.41 | 5.05 |
| action bar text on fill | 15.71 | 15.47 |
| action bar text on accent hover | 5.27 | 9.30 |

Three further requirements:

- The **2px rules drop to 72% ink in dark mode**. At full strength a
  2px rule on a dark ground vibrates and pulls the eye off the type it
  sits under. The action bar keeps its full-strength fill — it is the
  one element that must be found.
- The theme toggle's `aria-label` names the state clicking will
  produce ("Switch to light mode" while dark), not the current one.
- Mobile hit targets stay ≥44px; the action bar is 44px+ at every
  width.

## 10. Deviations and what is not being built

- **Phase 3 (3D hero) is shelved.** A rotating teal wireframe
  polyhedron wants the same job `LoopRing` now does — being the site's
  mark — and does it in a way that is not specific to this site. If the
  R3F work is revived later, the version worth building is the ring
  itself as a torus of bars on the same 9s clock, with the CSS
  `LoopRing` as its no-WebGL fallback (a better fallback than the
  gradient placeholder that spec proposes). No dependency is added by
  this phase.
- **The detail page is a ruled block, not `TerminalWindow`** — phase
  4's spec assumed the terminal vocabulary this design drops.
- **The nav underline is a CSS `scaleX` wipe, not an SVG
  `stroke-dashoffset` draw** — same read, one rule instead of an SVG
  per link.
- **No new dependency** beyond `next/font`'s built-in Google provider.
- Recording the demo GIF, and writing the About/resume copy, remain
  content work.

## 11. Testing

Existing tests that this phase must update rather than delete:
`lib/portfolio-tokens.test.ts` (new values), every
`app/(site)/**/page.test.tsx` (changed structure), `SiteHeader.test.tsx`,
`ThemeToggle.test.tsx`, `BlogList.test.tsx`, and the Playwright specs
under `e2e/`.

New automated coverage:

- `portfolio-tokens.test.ts` — the table in §9, both modes, plus an
  assertion that the dark 72% rule colour is still distinguishable from
  the ground.
- `LoopRing` — renders `HEAD.length` accent bars at each end, the same
  total as the shared envelope array, and no motion class when
  `prefers-reduced-motion` is set.
- `ProjectDemoGif` — `priority` controls `loading`; `alt`, `width`,
  `height` pass through (phase 4's spec §6).
- `/projects/[slug]` — renders for each slug in `content/projects.ts`,
  `notFound()` for unknown, GIF section present/absent with and without
  `demoGif`.
- `/projects` — rows link to `/projects/[slug]`, not `project.href`.

Not automated, per this repo's convention (CLAUDE.md: frontend visual
changes are verified in a live browser): the type rendering, grid
alignment, ring geometry, and every hover/loop animation. Manual pass
required in both modes, at desktop and 390px, and with
`prefers-reduced-motion` enabled, before the phase is considered done.

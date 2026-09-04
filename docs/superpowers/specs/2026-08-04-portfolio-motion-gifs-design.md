# Portfolio Motion & GIFs (UI Overhaul Phase 4) — Design Spec

Date: 2026-08-04

## 1. Purpose

Fourth phase of the portfolio UI overhaul (depends on phase 1's tokens
and phase 2's `TerminalWindow` component, reused here for the new
project detail page). Adds GIF-driven project demos and a small set of
SVG micro-interactions to existing hover states. No source found during
research covered GIF-specific performance/accessibility data (see phase
1 spec's caveats) — the eager/lazy handling here follows the general
image-LCP guidance that *was* verified, applied deliberately rather than
by default.

## 2. Architecture

```
app/components/site/
  ProjectDemoGif.tsx        ← new: <img> wrapper, priority-aware loading

app/content/projects.ts       ← modified: Project type gains optional demoGif?: string

app/app/(site)/projects/
  page.tsx                     ← modified: rows link to [slug] detail page, not project.href directly
  [slug]/page.tsx                ← new: detail page (generateStaticParams, TerminalWindow, demo GIF, outbound link)

app/components/site/
  SiteHeader.tsx              ← modified: nav links get SVG underline-draw hover
  ThemeToggle.tsx              ← modified: text-only button becomes icon (sun/moon morph) + aria-label
```

`(site)/projects/page.tsx`'s row marker (the small dot from phase 2's
`ls`-listing) becomes an SVG chevron, in the same file.

## 3. Project detail page

`/projects/[slug]` — `generateStaticParams()` from `content/projects.ts`
slugs; unknown slugs call `notFound()`. Renders inside phase 2's
`TerminalWindow` (title e.g. `cat bgm-looper.md`), showing: project
name, full description, the demo GIF (if `demoGif` is set on that
project's entry), and an "Open →" link/button to `project.href` (the
actual tool). `/projects` list rows link here now instead of straight
to `project.href` — the outbound link lives on the detail page.

`Project` type gains one optional field:

```ts
export type Project = {
  slug: string;
  name: string;
  description: string;
  href: string;
  demoGif?: string; // path under /public, e.g. "/demos/bgm-looper.gif"
};
```

No GIF asset is being recorded or added as part of this spec — that's
manual content work, not code. `demoGif` stays unset on the existing
`bgm-looper` entry until a real recording exists; the detail page
renders correctly either way (section omitted when absent, not a
placeholder image).

## 4. ProjectDemoGif component

Plain `<img>`, not `next/image` — `next/image` re-encodes images and can
break GIF animation, which defeats the point of using a GIF here. Props:
`src`, `alt` (required), `width`, `height` (required, to reserve layout
space and avoid a CLS hit while the file loads), `priority?: boolean`
(default `false`).

`priority` controls the `loading` attribute directly (`priority` →
`loading="eager"` or omitted; otherwise `loading="lazy"`) rather than
every usage defaulting to lazy. On the detail page, the demo GIF is
likely the first substantial content after the H1 and may itself be the
page's LCP element — the verified research finding was specifically
that lazy-loading *above-the-fold* content hurts LCP, not that lazy
loading is universally bad — so the detail page passes `priority`.
Any future below-the-fold usage of this component (e.g. a thumbnail
further down a longer page) would leave `priority` unset.

## 5. SVG micro-interactions

Three targets, each an enhancement to an existing hover state, each
gated on `prefers-reduced-motion: reduce` (instant state change instead
of the animated transition — same pattern as the existing `.playhead`
rule in `globals.css`):

- **Nav links** (`SiteHeader.tsx`): replace the current
  `border-b border-transparent … hover:border-accent` fade with a small
  inline SVG underline beneath each label that draws in on hover via
  `stroke-dashoffset` (teal, matching the accent token). Same technique
  reused across all nav links — one interaction pattern, not a
  different animation per link.
- **Project list rows** (`(site)/projects/page.tsx`): the current
  static `<span>` dot marker (`bg-muted/60` → `bg-accent` on hover)
  becomes a small inline SVG chevron that slides right
  (`translateX`) on hover, reading as an "enter this project" affordance
  consistent with the terminal/file-listing framing from phase 2.
- **Theme toggle** (`ThemeToggle.tsx`): the button currently has no
  icon at all (text-only, "Light mode"/"Dark mode"). Add a small inline
  sun/moon SVG that morphs between the two states on click (crossfaded
  opacity + rotate on the two path groups). The button's accessible
  name stays explicit via `aria-label` (e.g. `"Switch to light mode"` /
  `"Switch to dark mode"`) regardless of whether the visible text label
  is kept alongside the icon or dropped in favor of icon-only — decide
  the exact visual (icon+label vs icon-only) during implementation, but
  the `aria-label` requirement is not optional either way.

## 6. Testing

- `ProjectDemoGif`: `priority=true` → `loading` attribute is `"eager"`
  or absent (not `"lazy"`); `priority=false`/default → `loading="lazy"`;
  `alt`, `width`, `height` pass through.
- `/projects/[slug]/page.tsx`: renders for each known slug in
  `content/projects.ts`; calls `notFound()` for an unknown slug; renders
  the demo-GIF section when `demoGif` is set, omits it cleanly when not
  (test both states using entries with and without the field).
- `/projects/page.tsx`: existing test updated so row links point to
  `/projects/[slug]`, not `project.href` directly.
- `ThemeToggle`: existing dark-class-toggle and `localStorage`
  assertions unchanged; add an assertion that `aria-label` is present
  and reflects the *next* state (what clicking will switch to), not the
  current one.
- SVG hover-transition visuals (underline draw, chevron slide, icon
  morph) are not covered by automated tests — CSS/SVG-transition
  behavior, verified in a live browser per this project's existing
  frontend-changes convention (CLAUDE.md), across both themes and with
  `prefers-reduced-motion` enabled.

## 7. Out of scope

- Recording or sourcing the actual demo GIF asset(s) — content work,
  not part of this spec.
- SVG micro-interactions on any element beyond the three listed above
  (e.g. contact/social icons were considered and explicitly deferred).
- The 3D hero and terminal-layer phases — separate specs
  (`2026-08-04-portfolio-3d-hero-design.md`,
  `2026-08-04-portfolio-terminal-layer-design.md`).

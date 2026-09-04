# Portfolio Terminal Layer (UI Overhaul Phase 2) — Design Spec

Date: 2026-08-04

## 1. Purpose

Second phase of the portfolio UI overhaul (see
`2026-08-04-portfolio-color-tokens-design.md` for phase 1, which this
phase depends on — it uses the teal accent token that phase ships).
Adds a terminal-styled visual layer: a reusable terminal-chrome
component, first applied to reskin `/projects` as an `ls`-style
directory listing, plus a secondary Cmd+K command-bar nav built on the
same chrome. Grounded in two real open-source references found during
research (`navnee1h/terminal-portfolio`, `chyinan/terminal-ui-design-system`)
for the visual pattern — re-themed to this site's teal palette rather
than those repos' warm/neon defaults.

No code-block/syntax-highlighting exists on the site yet (blog has none,
`/projects` is a plain list), so the chrome component's only concrete
target in this phase is `/projects`. It's built generic enough that blog
code blocks get the same treatment for free if syntax highlighting is
ever added later — that addition itself is out of scope here.

## 2. Architecture

```
app/components/site/
  TerminalWindow.tsx      ← new: chrome wrapper (title bar + content slot)
  CommandBar.tsx           ← new: Cmd+K palette, built on TerminalWindow
  SiteHeader.tsx            ← modified: add visible ⌘K trigger chip

app/lib/site/
  commands.ts               ← new: static command list (label, href/action)

app/app/(site)/
  layout.tsx                 ← modified: mount <CommandBar /> once
  projects/page.tsx           ← rewritten: renders inside TerminalWindow

app/app/globals.css           ← modified: 2 new fixed (non-theme-swapped) tokens
```

## 3. Terminal chrome tokens

Terminal chrome is dark regardless of the site's light/dark theme —
that's what makes it read as a terminal rather than just a bordered box.
Two new custom properties on `:root`, **not** inside the `@theme` /
`:root.dark` blocks that phase 1 touches, so they don't flip with the
theme toggle:

```css
:root {
  --color-terminal-bg: #0e1420;
  --color-terminal-fg: #d7deec;
}
```

Accent inside terminal chrome reuses the existing `--color-accent` teal
(already shipped by phase 1) rather than introducing a third color —
one accent hue across the whole site, including its terminal-styled
corners.

## 4. TerminalWindow component

Presentational, no state. Props: `title: string`, `children: ReactNode`.
Renders:
- A title bar: three inert traffic-light dots + `title` in mono, small
  caps, muted.
- A content area using `--color-terminal-bg`/`-fg`, monospace, the
  content passed as `children`.

Used standalone to wrap `/projects`: the page becomes one
`<TerminalWindow title="projects — zsh">`, with a `$ ls` line above the
existing project list and each entry rendered as a row (name + one-line
description), same data (`content/projects.ts`) and same links as today
— only the chrome and framing change, not the underlying navigation.

## 5. CommandBar component

Not a real shell/parser — that's unnecessary scope for a site with
~8 destinations (6 nav links + BGM Looper + theme toggle). It's a
filtered command list (VSCode Cmd+P pattern) styled with terminal
chrome and a `$` prompt glyph, not a REPL with scrollback/history.

**Trigger:**
- Global `keydown` listener (mounted once, in `(site)/layout.tsx`) for
  `Cmd+K` / `Ctrl+K`, calling `preventDefault` so it doesn't collide with
  browser/OS shortcuts.
- A visible `⌘K` chip added to `SiteHeader`, doubling as the mouse/touch
  entry point — the keyboard shortcut alone isn't discoverable and isn't
  reachable on mobile, so a hidden-only trigger is not acceptable.

**Behavior:**
- Opens as a modal overlay (`role="dialog"`, `aria-modal="true"`),
  wrapped in `TerminalWindow`.
- Text input styled as a `$` prompt; typing filters the static command
  list from `lib/site/commands.ts` by label/alias substring match.
- Arrow up/down moves selection, `Enter` runs the selected command
  (`router.push(href)` for nav commands, theme-context call for
  `theme dark`/`theme light`), `Escape` closes without action.
- Focus trapped inside the dialog while open; closing (via Escape, a
  command running, or an outside click) returns focus to the `⌘K`
  trigger chip.
- Open/close transition is a fade only; disabled entirely under
  `prefers-reduced-motion: reduce`, matching the existing `.playhead`
  pattern in `globals.css`.

**Command set** (`lib/site/commands.ts`), each `{ label, hint, run }`:
`cd home`, `cd about`, `cd projects`, `cd resume`, `cd blog`,
`cd contact` (one per `SiteHeader` nav link, same hrefs), `open
bgm-looper` (→ `/tools/bgm-looper`), `theme dark`, `theme light`.

## 6. Testing

- `TerminalWindow`: renders `title` and `children`; snapshot-free
  assertion on structure (title bar present, content present).
- `CommandBar`: opens on `Cmd+K` and on trigger-chip click; typing
  filters the list; `Enter` on a filtered command navigates (mock
  `next/navigation`'s `useRouter`); `Escape` closes and returns focus to
  the trigger; open state traps focus (Tab doesn't leave the dialog).
- `projects/page.tsx`: existing test updated for the new terminal-window
  markup, still asserts each `content/projects.ts` entry's name,
  description, and link render.
- `cd app && npm test` passes; no bgm-looper-tool test affected (tool
  pages don't consume `TerminalWindow`/`CommandBar`).

## 7. Out of scope

- Real shell command parsing (arbitrary `ls`/`cat`/`cd` arguments,
  command history, output scrollback).
- Applying terminal chrome anywhere except `/projects` (no blog
  code-block integration — no syntax highlighting exists to hang it on
  yet).
- The 3D hero and GIF/motion phases — separate specs.

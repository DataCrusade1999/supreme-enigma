# Storybook + Chromatic — Design

**Date:** 2026-09-18
**Status:** Approved, ready for planning
**Branch:** `feat/storybook-chromatic`

## 1. Problem

`web/components/` holds 17 presentational components with a hand-built design
system behind them: `app/globals.css` declares every colour token twice (a
light `@theme` block and a `:root.dark` override), two `next/font/google` faces
are wired onto `<html>` in `app/layout.tsx`, and `lib/site/theme.ts` toggles the
`dark` class at runtime.

Nothing in the test suite renders any of that. `*.test.tsx` uses Testing Library
under jsdom, which has no layout engine and no CSS cascade — it asserts on
classnames and text, never on what the component looks like. `lib/portfolio-tokens.test.ts`
asserts contrast ratios on the token *values*, but cannot tell whether a
component actually consumes the right token. Playwright's e2e specs check
behaviour and a11y on whole pages, not component appearance.

The consequence: a change that alters how a component renders — a wrong token, a
broken dark-mode override, a font that silently falls back to Georgia — ships
green. There is no baseline to diff against, and no isolated surface on which to
develop a component without booting the whole app.

A second constraint shapes the solution: the development machine is slow. Any
design that makes the local loop heavier is worse than no design, even if it
catches more.

## 2. Goals and non-goals

**Goals**

- An isolated render surface (Storybook) for every component in `web/components/`.
- Automated visual regression on every PR into `dev`, with a durable baseline.
- Snapshots that render with the real fonts and the real theme tokens in both
  light and dark — a snapshot of the fallback stack is worse than no snapshot,
  because it reads as coverage.
- All recurring cost paid by CI, not by the local machine. Storybook installed
  locally and runnable on demand; never run as part of `npm test` or a
  pre-commit path.
- Stay inside Chromatic's 5,000-snapshot/month free tier.
- Touch no Terraform.

**Non-goals**

- `@storybook/addon-vitest` (running stories as tests inside the existing Vitest
  run). A natural follow-up, deliberately out of scope here — see §10.
- Interaction tests / `play` functions. Behaviour is already covered by Vitest
  and Playwright.
- Replacing any existing test layer. This adds a layer; it removes none.
- Hosting a browsable Storybook per branch on Vercel.
- Responsive/viewport snapshots. See §5 for why, and what it would cost.
- Stories for `app/` route components or `lib/`.

## 3. Decisions

| Question | Decision | Why |
|---|---|---|
| Storybook framework | `@storybook/nextjs-vite` (Storybook 10.6) | Peer deps are `next ^16`, `react ^19`, `vite ^5–^8`. The repo's `vite@6.4.3` and `vitest@4.1.11` stay as they are — no forced upgrade. The Vite builder also matches the toolchain Vitest already runs on. |
| Where Storybook is built in CI | `chromaui/action` builds it, in a dedicated `chromatic` job | Approach A in §4. Parallel to `test`, ~2–3 min, zero local cost. |
| Theme modes snapshotted | Both light and dark | `globals.css` declares every token in both blocks precisely so neither mode falls back to the other's value. A dark-only baseline would never catch a broken light override, which is the specific regression this is for. |
| How both modes are captured | `parameters.chromatic.modes` set globally in `preview.tsx` | Each story snapshots twice without writing two story exports per component. |
| Trigger scope | PRs into `dev`, and pushes to `dev` | `dev` is the default branch and the baseline. Promotion PRs (`dev → stage`, `stage → main`) and `stage`/`main` pushes are skipped: that SHA was already snapshotted on `dev`, so re-running spends budget for no new information. |
| PR gate | Advisory — `exitZeroOnChanges: true` (the action's default, set explicitly) | Chromatic's own `UI Tests` / `Storybook Publish` PR checks carry the diff link; the CI job stays green. Consistent with how this repo treats its two review bots: read the finding, judge it yourself. A red X for every intentional restyle is friction without a second reviewer to justify it. |
| Baseline acceptance | `autoAcceptChanges: dev` | Required, not just tidy: this repo squash-merges feature PRs into `dev`, and Chromatic's docs note that GitHub squash/rebase creates commits unassociated with the merged branch, so baselines do not carry over. `autoAcceptChanges` on the target branch is the documented remedy (the alternative is installing Chromatic's GitHub App for UI Review). |
| Snapshot economy | TurboSnap (`onlyChanged: true`) | Cuts a typical PR from ~102 snapshots to the handful of changed components. Requires `fetch-depth: 0`. |
| Vercel `ignore_command` | Left alone | `git diff --quiet HEAD^ HEAD -- web content` (`infra/main/shared.tf:349`) treats a stories-only commit as deploy-relevant, so such a commit redeploys an identical site. Wasteful, harmless, and avoids dragging Terraform into this change — which CI cannot validate (see §9). |
| Dependabot PRs | Excluded from the job's `if:` | Actions secrets are not exposed to Dependabot-triggered runs, so `CHROMATIC_PROJECT_TOKEN` would be empty and the job would fail red on every bump — a missing token is an error, not a "change", so the advisory gate does not absorb it. Dependency bumps that do move the UI are caught by the next push to `dev`. |
| Story location | Colocated, `components/**/*.stories.tsx` | Matches where `*.test.tsx` already lives. |
| Story scope | All 17 components | §6 establishes that all 17 render without a mock. Leaving some out creates gaps that read as deliberate later. |

## 4. Approaches considered

**A — dedicated `chromatic` job; the action builds Storybook. (Chosen.)**
`chromaui/action` runs `build-storybook` on its own runner in parallel with
`test`. One job, one secret, nothing on the local machine. The cost is that
Storybook is built twice if a static build is ever also wanted as an artifact —
about 90 seconds of free CI.

**B — build in the existing `test` job, upload the artifact, pass
`storybook-build-dir` to Chromatic.** Saves one build. Rejected because it
couples visual review to the slowest job in the repo (`test` already does
`apt-get install ffmpeg`, pytest, a Next build and Playwright) and because
`release`'s `if:` is hand-rolled against `needs.test.result` — folding another
failure mode into `test` widens what can block a release.

**C — host Storybook on Vercel, point Chromatic at the URL.** Gives a browsable
per-branch Storybook. Rejected: a second Vercel project and a second
`ignore_command` to keep in sync, for a convenience nobody asked for.

## 5. Snapshot budget

Chromatic's free tier is 5,000 snapshots/month.

| | Snapshots |
|---|---|
| 17 components × ~3 stories | ~51 |
| × 2 theme modes | **~102 per cold build** |
| Typical PR with TurboSnap | ~4–12 |

Adding a mobile viewport would take a cold build to ~153 (three modes) and a
typical PR to ~6–18. That is affordable today but leaves no headroom as components are added,
and responsive breakage is partly covered by the existing Playwright specs. Not
included; revisit if the component count stabilises.

The trigger scope in §3 is the other half of the budget: running on all three
permanent branches plus every PR would roughly triple spend for no extra signal,
because a promotion PR's head SHA is one already snapshotted on `dev`.

## 6. Component audit

Every component in `web/components/` was checked for constructs that will not
mount in Storybook: `async` components, `next/headers`, `server-only`, and
server-side MDX/Markdoc rendering.

**None were found.** All 17 are synchronous and prop-driven:

- `blog/` — `BlogList`, `PostBody`
- `newsletter/` — `IssueBody`, `IssueList`, `IssueRail`, `SendButton`, `SubscribeForm`
- `site/` — `CommandBar`, `FeaturedTool`, `GridBackdrop`, `LoopRing`, `PageMasthead`, `ProjectDemoGif`, `SiteFooter`, `SiteHeader`, `TerminalWindow`, `ThemeToggle`

`PostBody` and `IssueBody` take already-rendered children rather than doing
Markdoc work themselves, so neither needs a content mock. `CommandBar` imports
`useRouter` from `next/navigation` and several components use `next/link`;
`@storybook/nextjs-vite` mocks both automatically, so no manual stub is needed.

Only three components (`SendButton`, `CommandBar`, `ThemeToggle`) carry
`"use client"`. The other fourteen are shared components that happen to be
rendered from server components — which is why they story cleanly.

## 7. Architecture

All new files live under `web/`.

### 7.1 `.storybook/main.ts`

```ts
framework: '@storybook/nextjs-vite'
stories: ['../components/**/*.stories.tsx']
addons: ['@storybook/addon-themes', '@chromatic-com/storybook']
```

No `staticDirs` — there is no `web/public/` directory.

### 7.2 `.storybook/preview.tsx`

This file is what makes a snapshot truthful rather than merely green. Three
things the app gets from `app/layout.tsx` that a story never would:

1. **Tailwind and the tokens.** `import '../app/globals.css'`, so the `@theme`
   block and its `:root.dark` override both load.
2. **The fonts.** `app/layout.tsx` declares `Instrument_Serif` and
   `IBM_Plex_Sans` via `next/font/google` and writes their `.variable` classes
   onto `<html>`; `globals.css` points `--font-display`/`--font-ui` at those
   variables. A story renders none of that, so without a decorator every
   snapshot falls back to Georgia and `ui-sans-serif`. `preview.tsx`
   re-declares both faces (`nextjs-vite` supports `next/font/google`) and a
   decorator applies both `.variable` classes **to `document.documentElement`**
   (via `useEffect`), not to a wrapper `<div>`.

   The target is load-bearing, not a detail. `@theme` emits
   `--font-display: var(--font-instrument-serif), serif` on `:root`, and a
   custom property resolves its inner `var()` at computed-value time *on the
   element that declares it*; descendants inherit the already-computed result.
   Define `--font-instrument-serif` on a wrapper and `--font-display` has
   already collapsed to `serif` on `:root` — every story renders in the
   fallback. Same target as `withThemeByClassName`'s `parentSelector: 'html'`,
   and the same thing `app/layout.tsx` does.

   **This is the failure mode that looks correct and is not** — a baseline of
   the fallback stack silently locks in the wrong typography and then reports
   every future fix as a regression.
3. **The theme class.** `withThemeByClassName({ themes: { light: '', dark: 'dark' }, parentSelector: 'html' })`
   — `dark` on `<html>`, exactly what `lib/site/theme.ts` and the
   pre-hydration script in `app/layout.tsx` do. Any other element would not
   match `:root.dark` and the dark tokens would never apply.

Then, globally:

```ts
parameters: {
  chromatic: { modes: { light: { theme: 'light' }, dark: { theme: 'dark' } } },
}
```

Chromatic modes set Storybook globals, which `withThemeByClassName` reads — so
every story is captured twice from one export.

### 7.3 Stories

One `*.stories.tsx` per component, colocated. Where a `*.test.tsx` already
builds a prop fixture (`BlogList`, `IssueList`, `FeaturedTool`, `IssueRail`),
the story imports or mirrors that same fixture rather than inventing a second
set of sample data.

Roughly three stories per component: the default state, plus whatever states
change the rendering (empty list, long title, active/pressed). Not an
exhaustive matrix — each additional story costs two snapshots forever.

### 7.4 `package.json`

```json
"storybook": "storybook dev -p 6006",
"build-storybook": "storybook build"
```

Neither is referenced by `npm test`, `npm run lint`, or any hook. Storybook is
installed locally — unavoidable, `npm install` pulls devDependencies — but is
only ever *run* locally on demand. This is what satisfies the "keep the machine
lean" constraint: the deps sit on disk, the work happens on CI.

### 7.5 `.gitignore`

Add `storybook-static/` to `web/.gitignore`.

### 7.6 CI — new `chromatic` job in `.github/workflows/deploy.yml`

A sibling of `test`, running in parallel. **Not** in `release`'s `needs:` — a
visual diff must never block a release, and `release`'s `if:` is hand-rolled, so
adding a job there changes gating semantics.

```yaml
chromatic:
  runs-on: ubuntu-latest
  if: >-
    github.actor != 'dependabot[bot]' && (
      (github.event_name == 'push' && github.ref_name == 'dev') ||
      (github.event_name == 'pull_request' && github.base_ref == 'dev')
    )
  steps:
    - uses: actions/checkout@v7
      with:
        fetch-depth: 0          # TurboSnap needs history
    - uses: actions/setup-node@v7
      with:
        node-version: "22"
    - working-directory: web
      run: npm install
    - uses: chromaui/action@v18
      with:
        projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
        workingDir: web
        onlyChanged: true       # TurboSnap
        exitZeroOnChanges: true # advisory, never red
        exitOnceUploaded: true
        autoAcceptChanges: dev
```

`chromaui/action` is pinned to `v18` (currently v18.9.4) rather than `@latest`,
and `checkout@v7`/`setup-node@v7`/Node 22 match what the `test` job already
uses.

## 8. Verification

Storybook carries no assertions of its own, so "it builds" is not evidence.
Success criteria, in order:

1. `cd web && npm run build-storybook` exits 0 and the index reports **17**
   component entries. A component silently excluded by the stories glob is the
   most likely quiet failure.
2. **Font check.** Render a story and assert the computed `font-family` of a
   display-font element resolves to Instrument Serif, not Georgia. This is
   §7.2's failure mode and the one thing that must be checked directly rather
   than eyeballed.
3. **Theme check.** A dark-mode story's computed background resolves to
   `#131311`, not `#eceae5` — i.e. `withThemeByClassName` is reaching `<html>`.
4. First `chromatic` run on `dev` completes and establishes a baseline; the
   Chromatic UI shows two modes per story.
   Confirm `UI Tests` and `Storybook Publish` appear as commit statuses on the
   next PR — if they do not, the project is not linked to the repo (§11.1) and
   the advisory gate is silently a no-op.
5. **Regression proof.** Change `--color-accent` in `globals.css` by one value
   on a scratch branch, open a PR into `dev`, and confirm Chromatic reports a
   diff in both modes and that the CI job still reports green (advisory gate
   working as specified). Revert.
6. `cd web && npm test` and `npm run lint` still pass — the new devDependencies
   and config must not perturb the existing suites. In particular
   `vitest.config.ts`'s `exclude` list is hand-written and spreads
   `configDefaults.exclude`; confirm `*.stories.tsx` files are not picked up as
   test files.

## 9. Risks

- **Silent fallback typography.** Covered by §8.2. Called out separately here
  because it is the only failure that produces a confident, wrong baseline.
- **No Terraform validation in CI.** Not a risk for this change specifically —
  nothing here touches `infra/` — but it is why §3 chose to leave
  `ignore_command` alone rather than fold a one-line pathspec edit into a PR
  that has no other reason to run `terraform plan`.
- **TurboSnap and `fetch-depth: 0`.** TurboSnap silently degrades to a full
  build when it cannot resolve git history. If snapshot counts come in at ~100
  per PR rather than ~10, the checkout depth is the first thing to check.
- **Free-tier ceiling.** ~102 snapshots per cold build against 5,000/month leaves
  wide headroom under the §3 trigger scope, but widening triggers or adding
  viewports erodes it quickly. §5 has the arithmetic.
- **Advisory gate degrading to silence.** `exitZeroOnChanges` plus
  `exitOnceUploaded` means the Actions job is green before Chromatic has even
  finished comparing. Every PR-visible signal therefore comes from Chromatic's
  own checks, which exist only because the project is repo-linked. Verified by
  §8.4.
- **Redundant Vercel deploys.** Accepted, per §3. A stories-only commit
  redeploys an identical site.

## 10. Follow-ups (not in this change)

- `@storybook/addon-vitest` — run stories as tests inside the existing Vitest
  run, which would give component-level smoke coverage for free on every
  `npm test`. Scope beyond what was asked here; worth revisiting once stories
  exist.
- A mobile-viewport mode, if snapshot budget allows (§5).
- Hosting Storybook per branch, if a browsable component catalogue ever becomes
  useful to someone other than the author.

## 11. Manual steps

These are not automatable and block everything else:

1. Create a Chromatic project **linked to** `DataCrusade1999/supreme-enigma`.
   Linking is what makes Chromatic post its `UI Tests` / `Storybook Publish` PR
   checks — per Chromatic's docs, linked GitHub projects get that "out of the
   box", with no separate GitHub App install. Since the gate here is advisory
   and the job exits green, those checks are the *only* PR-visible signal: an
   unlinked project means the whole thing runs and reports nothing.
2. Add `CHROMATIC_PROJECT_TOKEN` as a GitHub repository secret.

Until both exist, the `chromatic` job fails on every run. Record in the
pending-manual-actions memory.

## 12. Process

Per `CLAUDE.md`:

- Tracking issue: **#209**. Close it from the PR with `Closes #209`.
- `CHANGELOG.md` entry under `## [Unreleased]`, by hand, in the same PR.
- PR targets `dev`, merged with `--squash --delete-branch`.
- No Terraform touched, so the `terraform plan` precondition does not apply.

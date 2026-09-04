# Portfolio 3D Hero (UI Overhaul Phase 3) — Design Spec

Date: 2026-08-04

## 1. Purpose

Third phase of the portfolio UI overhaul (depends on phase 1's teal
accent token and phase 2's `/projects` terminal-window listing, which
this phase adds a per-entry 3D accent to). Adds a minimal 3D presence:
a low-poly wireframe shape in the home hero, and a smaller version of
the same primitive next to each `/projects` entry — using the
research-validated Three.js + React Three Fiber + Drei stack, scoped
down to a single reusable shape rather than the fuller particle/
multi-scene-type patterns research found, since the original request
said "3D shapes" specifically and the site's stated goal is minimalism.

## 2. Architecture

```
app/components/site/hero/
  WireframeShape.tsx      ← new: shared low-poly geometry + rotation primitive
  HeroScene.tsx             ← new: home-hero Canvas wrapper (dynamic import)
  ProjectAccent.tsx          ← new: small per-project Canvas wrapper (dynamic import)
  SceneFallback.tsx           ← new: static placeholder (loading/reduced-motion N/A/no-WebGL/error)
  useDeviceTier.ts              ← new: viewport-width hook, 'full' | 'reduced'

app/app/(site)/page.tsx            ← modified: render <HeroScene /> in the hero section
app/app/(site)/projects/page.tsx    ← modified: render <ProjectAccent /> per entry
app/package.json                      ← + three, @react-three/fiber, @react-three/drei
```

## 3. WireframeShape (shared primitive)

A single low-poly polyhedron (icosahedron or dodecahedron — pick
whichever renders as a cleaner wireframe at small sizes during
implementation) rendered as edges-only geometry, teal
(`#1f8a82` light-mode-equivalent / `#5ec8c0` dark — same hex pair as the
`--color-accent` token from phase 1, hardcoded here since WebGL
materials can't consume CSS custom properties; if the accent token ever
changes, this component must be updated manually — flagged as a known
sync point, not solved automatically).

Props: `size: number`, `detail: 'full' | 'reduced'` (from
`useDeviceTier`), `spin: boolean` (false under
`prefers-reduced-motion: reduce`). Rotation via `useFrame` at a slow,
constant rate when `spin` is true; frozen at a fixed orientation when
false — the shape stays visible either way, only the motion stops.

Reused at two scales: larger in `HeroScene`, smaller in `ProjectAccent`.
No per-project scene-type variety (particles/orbit/wave/helix/sphere,
as some research references had) — with exactly one project in
`content/projects.ts` today, building a scene-type registry would be
speculative; `ProjectAccent` renders the same primitive shape per entry,
scaling automatically as more projects are added later without further
design work.

## 4. Device-tier and motion handling

`useDeviceTier()` — a plain viewport-width hook (`~768px` breakpoint, no
`navigator.hardwareConcurrency`/device-memory feature detection, kept
simple and consistent with the rest of the site's responsive
breakpoints), returns `'reduced'` below the breakpoint. `WireframeShape`
uses this to lower its geometry detail (fewer subdivisions) rather than
disabling itself — this is the "adaptive complexity" approach, chosen
over swapping to a static image on mobile, since the goal is a
consistent 3D presence across devices, tuned by detail rather than
presence/absence.

`prefers-reduced-motion` is a **separate axis**, not folded into device
tier: it stops rotation (`spin={false}`) regardless of viewport width or
device-tier value. A narrow-viewport visitor with no motion preference
still gets a (lower-detail) spinning shape; a wide-viewport visitor with
`prefers-reduced-motion` still gets a (full-detail) static shape.
Conflating the two would mean reduced-motion users on mobile lose the
shape's detail for a reason unrelated to their actual preference.

## 5. Loading strategy

`HeroScene` and `ProjectAccent` are both `dynamic(() => import(...), {
ssr: false })` — Three.js/R3F require browser WebGL APIs, so
server-rendering them isn't possible anyway, and code-splitting keeps
`three`/`@react-three/fiber`/`@react-three/drei` out of each route's
main JS bundle. This does not conflict with the phase-1-research LCP
finding (don't lazy-load above-the-fold *images*) — the canvas is a
decorative accent, not the page's LCP element, which is the hero
heading text; deferring the 3D module's JS doesn't delay that text's
paint, and arguably helps by not competing for bandwidth with it.

`SceneFallback` (a static teal-tinted CSS gradient, roughly shaped to
suggest the wireframe silhouette without rendering it) covers three
cases, using the same component for all three rather than three custom
placeholders:
- **Loading**: shown by the `dynamic()` import's `loading` option while
  the chunk fetches.
- **No WebGL / render error**: `HeroScene`/`ProjectAccent` render
  `WireframeShape` inside a React error boundary; any thrown error
  (including a `Canvas` failing to acquire a WebGL context) renders
  `SceneFallback` instead of crashing the page or that section.

`prefers-reduced-motion` does **not** use `SceneFallback` — per §4, a
reduced-motion visitor still sees the real (frozen) shape, not the
gradient placeholder.

## 6. Testing

WebGL rendering itself is not meaningfully unit-testable and this
project's existing convention (CLAUDE.md) is to verify frontend visual
changes in a live browser rather than through automated visual
assertions — that convention applies here, not a new exception.

Automated tests cover pure logic only:
- `useDeviceTier`: returns `'reduced'` below ~768px, `'full'` at/above,
  via a mocked `window.innerWidth`/resize listener.
- Rotation-speed / `spin` derivation from a mocked
  `prefers-reduced-motion` media query, independent of device tier.
- Error-boundary path: force `WireframeShape`/`Canvas` to throw (mocked
  WebGL context failure) and assert `SceneFallback` renders instead of
  the tree crashing.

**Manual verification required before this phase is considered done**
(per CLAUDE.md's frontend-changes rule): desktop browser, a narrow
(<768px) viewport, and `prefers-reduced-motion` enabled — confirm the
shape renders, rotates/freezes correctly in each combination, and that
`next build` output shows `three`/`@react-three/fiber`/`@react-three/drei`
landing in a split chunk rather than each route's main bundle.

## 7. Out of scope

- GSAP or any additional animation library — ambient rotation via
  `useFrame` doesn't need it; adding it now would be an unused
  dependency.
- Per-project scene-type variety (particles, orbit, wave, helix,
  sphere) — deferred until there's more than one project to
  differentiate.
- Lighting/shading beyond a wireframe material — kept minimal
  intentionally, per the site's minimalism goal.
- The motion/GIF phase and the terminal-layer phase's remaining scope —
  separate specs (`2026-08-04-portfolio-terminal-layer-design.md` and
  the forthcoming motion/GIF spec).

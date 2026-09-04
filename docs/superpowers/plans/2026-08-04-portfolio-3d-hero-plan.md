# Portfolio 3D Hero (UI Overhaul Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single reusable low-poly wireframe shape, rendered larger in the home hero and smaller next to each `/projects` entry, using React Three Fiber — device-tiered by viewport width, motion-gated by `prefers-reduced-motion`, and degrading to a static fallback on load/error.

**Architecture:** A shared `WireframeShape` R3F primitive, theme-aware via a small DOM-observing hook (`useSiteTheme`), rendered inside two dynamically-imported (`ssr: false`) Canvas wrappers — `HeroScene` (home page) and `ProjectAccent` (`/projects` rows) — each wrapped in a `SceneBoundary` error boundary that falls back to a static `SceneFallback` placeholder on any render error, including no-WebGL environments.

**Tech Stack:** `three`, `@react-three/fiber` (added this phase). No `@react-three/drei` — nothing in this plan's scope (one wireframe shape, ambient rotation) uses any Drei helper, so it's left out rather than installed unused. No GSAP, per the design spec.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-04-portfolio-3d-hero-design.md`.
- Depends on Phase 1 (teal accent hex values) and Phase 2 (`/projects` terminal-window listing, which this phase adds `ProjectAccent` into).
- WebGL rendering is not unit-tested (per spec §6 and this project's CLAUDE.md convention: frontend visual behavior is verified in a live browser). Automated tests in this plan cover pure hooks, `SceneFallback`, and `SceneBoundary` only.
- `prefers-reduced-motion` stops rotation (`spin={false}`) but keeps the shape visible — it is a separate axis from device tier, never conflated (spec §4).
- The accent hex values baked into `WireframeShape` (`#187a73` light / `#5ec8c0` dark) MUST be kept in sync with `app/app/globals.css`'s `--color-accent` — a documented manual sync point, not solved automatically.
- `cd app && npm test` must pass after every task.

---

### Task 1: Add dependencies

**Files:**
- Modify: `app/package.json`

**Interfaces:** none — setup only.

- [ ] **Step 1: Install the packages**

Run:

```bash
cd app && npm install three@^0.170.0 @react-three/fiber@^9.0.0
npm install -D @types/three@^0.170.0
```

- [ ] **Step 2: Verify the install didn't break anything**

Run: `cd app && npm test`
Expected: PASS (no new code yet — this just confirms `npm install` didn't corrupt the lockfile or break existing dependency resolution).

- [ ] **Step 3: Commit**

```bash
cd app && git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: add three.js and react-three-fiber for the 3D hero

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 2: `useDeviceTier` hook

**Files:**
- Create: `app/components/site/hero/useDeviceTier.ts`
- Test: `app/components/site/hero/useDeviceTier.test.tsx`

**Interfaces:**
- Produces: `useDeviceTier(): "full" | "reduced"`, breakpoint 768px. Consumed by Task 8 (`HeroSceneInner`) and Task 9 (`ProjectAccentInner`).

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/site/hero/useDeviceTier.test.tsx
import { describe, expect, it, act } from "vitest";
import { render, screen } from "@testing-library/react";
import { useDeviceTier } from "./useDeviceTier";

function TierProbe() {
  const tier = useDeviceTier();
  return <span>{tier}</span>;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

describe("useDeviceTier", () => {
  it("reports 'full' at or above the 768px breakpoint", () => {
    setViewportWidth(1024);
    render(<TierProbe />);
    expect(screen.getByText("full")).toBeInTheDocument();
  });

  it("reports 'reduced' below the 768px breakpoint", () => {
    setViewportWidth(500);
    render(<TierProbe />);
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });

  it("updates when the viewport is resized", () => {
    setViewportWidth(1024);
    render(<TierProbe />);
    expect(screen.getByText("full")).toBeInTheDocument();

    act(() => {
      setViewportWidth(500);
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByText("reduced")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run components/site/hero/useDeviceTier.test.tsx`
Expected: FAIL — `Cannot find module './useDeviceTier'`.

- [ ] **Step 3: Write the implementation**

```typescript
// app/components/site/hero/useDeviceTier.ts
"use client";

import { useEffect, useState } from "react";

const BREAKPOINT_PX = 768;

export type DeviceTier = "full" | "reduced";

function computeTier(): DeviceTier {
  return window.innerWidth >= BREAKPOINT_PX ? "full" : "reduced";
}

export function useDeviceTier(): DeviceTier {
  const [tier, setTier] = useState<DeviceTier>(() =>
    typeof window === "undefined" ? "full" : computeTier(),
  );

  useEffect(() => {
    function handleResize() {
      setTier(computeTier());
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return tier;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run components/site/hero/useDeviceTier.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd app && git add components/site/hero/useDeviceTier.ts components/site/hero/useDeviceTier.test.tsx
git commit -m "$(cat <<'EOF'
feat: add viewport-width device-tier hook for 3D detail scaling

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 3: `usePrefersReducedMotion` hook

**Files:**
- Create: `app/components/site/hero/usePrefersReducedMotion.ts`
- Test: `app/components/site/hero/usePrefersReducedMotion.test.tsx`

**Interfaces:**
- Produces: `usePrefersReducedMotion(): boolean`. Consumed by Task 8 and Task 9.

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/site/hero/usePrefersReducedMotion.test.tsx
import { describe, expect, it, vi, act } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

function ReducedMotionProbe() {
  const prefersReduced = usePrefersReducedMotion();
  return <span>{prefersReduced ? "reduced" : "full"}</span>;
}

function mockMatchMedia(initialMatches: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: initialMatches,
    media: query,
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.push(listener);
    },
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  return {
    fireChange(nextMatches: boolean) {
      listeners.forEach((listener) =>
        listener({ matches: nextMatches } as MediaQueryListEvent),
      );
    },
  };
}

describe("usePrefersReducedMotion", () => {
  it("reflects the initial media query state", () => {
    mockMatchMedia(true);
    render(<ReducedMotionProbe />);
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });

  it("defaults to full motion when the query doesn't match", () => {
    mockMatchMedia(false);
    render(<ReducedMotionProbe />);
    expect(screen.getByText("full")).toBeInTheDocument();
  });

  it("updates when the media query changes after mount", () => {
    const { fireChange } = mockMatchMedia(false);
    render(<ReducedMotionProbe />);
    expect(screen.getByText("full")).toBeInTheDocument();

    act(() => fireChange(true));
    expect(screen.getByText("reduced")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run components/site/hero/usePrefersReducedMotion.test.tsx`
Expected: FAIL — `Cannot find module './usePrefersReducedMotion'`.

- [ ] **Step 3: Write the implementation**

```typescript
// app/components/site/hero/usePrefersReducedMotion.ts
"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(QUERY);
    function handleChange(event: MediaQueryListEvent) {
      setPrefersReduced(event.matches);
    }
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return prefersReduced;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run components/site/hero/usePrefersReducedMotion.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd app && git add components/site/hero/usePrefersReducedMotion.ts components/site/hero/usePrefersReducedMotion.test.tsx
git commit -m "$(cat <<'EOF'
feat: add prefers-reduced-motion hook for the 3D hero

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 4: `useSiteTheme` hook

The design spec flagged that `WireframeShape`'s material color is hardcoded (WebGL can't read CSS variables) but needs a light/dark value — this hook is how it knows which one to use. Not present in the original spec's file list; added here as the concrete mechanism that requirement needs.

**Files:**
- Create: `app/components/site/hero/useSiteTheme.ts`
- Test: `app/components/site/hero/useSiteTheme.test.tsx`

**Interfaces:**
- Produces: `useSiteTheme(): "light" | "dark"`, tracking `document.documentElement`'s `dark` class (the same class `ThemeToggle` — `app/components/site/ThemeToggle.tsx` — toggles). Consumed by Task 7 (`WireframeShape`).

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/site/hero/useSiteTheme.test.tsx
import { describe, expect, it, waitFor } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSiteTheme } from "./useSiteTheme";

function ThemeProbe() {
  const theme = useSiteTheme();
  return <span>{theme}</span>;
}

describe("useSiteTheme", () => {
  it("reports 'light' when <html> has no dark class", () => {
    document.documentElement.classList.remove("dark");
    render(<ThemeProbe />);
    expect(screen.getByText("light")).toBeInTheDocument();
  });

  it("reports 'dark' when <html> has the dark class", () => {
    document.documentElement.classList.add("dark");
    render(<ThemeProbe />);
    expect(screen.getByText("dark")).toBeInTheDocument();
    document.documentElement.classList.remove("dark");
  });

  it("updates when the dark class is toggled after mount", async () => {
    document.documentElement.classList.remove("dark");
    render(<ThemeProbe />);
    expect(screen.getByText("light")).toBeInTheDocument();

    document.documentElement.classList.add("dark");

    await waitFor(() => expect(screen.getByText("dark")).toBeInTheDocument());
    document.documentElement.classList.remove("dark");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run components/site/hero/useSiteTheme.test.tsx`
Expected: FAIL — `Cannot find module './useSiteTheme'`.

- [ ] **Step 3: Write the implementation**

```typescript
// app/components/site/hero/useSiteTheme.ts
"use client";

import { useEffect, useState } from "react";

export type SiteTheme = "light" | "dark";

function computeTheme(): SiteTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useSiteTheme(): SiteTheme {
  const [theme, setTheme] = useState<SiteTheme>(() =>
    typeof document === "undefined" ? "dark" : computeTheme(),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(computeTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run components/site/hero/useSiteTheme.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd app && git add components/site/hero/useSiteTheme.ts components/site/hero/useSiteTheme.test.tsx
git commit -m "$(cat <<'EOF'
feat: add site-theme hook for WireframeShape's material color

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 5: `SceneFallback` component

**Files:**
- Create: `app/components/site/hero/SceneFallback.tsx`
- Test: `app/components/site/hero/SceneFallback.test.tsx`

**Interfaces:**
- Produces: `SceneFallback()` (no props) — a decorative, non-interactive placeholder `<div>`. Consumed by Task 6 (`SceneBoundary`), Task 8, Task 9.

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/site/hero/SceneFallback.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SceneFallback } from "./SceneFallback";

describe("SceneFallback", () => {
  it("renders a decorative, non-interactive placeholder", () => {
    const { container } = render(<SceneFallback />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run components/site/hero/SceneFallback.test.tsx`
Expected: FAIL — `Cannot find module './SceneFallback'`.

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/site/hero/SceneFallback.tsx
export function SceneFallback() {
  return (
    <div
      aria-hidden="true"
      className="h-full w-full rounded-full opacity-20"
      style={{
        background:
          "radial-gradient(circle at center, var(--color-accent) 0%, transparent 70%)",
      }}
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run components/site/hero/SceneFallback.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
cd app && git add components/site/hero/SceneFallback.tsx components/site/hero/SceneFallback.test.tsx
git commit -m "$(cat <<'EOF'
feat: add static SceneFallback placeholder

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 6: `SceneBoundary` error boundary

**Files:**
- Create: `app/components/site/hero/SceneBoundary.tsx`
- Test: `app/components/site/hero/SceneBoundary.test.tsx`

**Interfaces:**
- Consumes: `SceneFallback` (Task 5).
- Produces: `SceneBoundary` (class component, named export, props `{ children: ReactNode }`) — catches any render/effect error thrown by its children and renders `SceneFallback` instead. Consumed by Task 8, Task 9.

- [ ] **Step 1: Write the failing tests**

```tsx
// app/components/site/hero/SceneBoundary.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SceneBoundary } from "./SceneBoundary";

function ThrowingChild(): never {
  throw new Error("no WebGL context");
}

describe("SceneBoundary", () => {
  it("renders the fallback instead of crashing when a child throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <SceneBoundary>
        <ThrowingChild />
      </SceneBoundary>,
    );

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    consoleError.mockRestore();
  });

  it("renders children normally when nothing throws", () => {
    const { getByText } = render(
      <SceneBoundary>
        <p>real scene</p>
      </SceneBoundary>,
    );
    expect(getByText("real scene")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run components/site/hero/SceneBoundary.test.tsx`
Expected: FAIL — `Cannot find module './SceneBoundary'`.

- [ ] **Step 3: Write the implementation**

```tsx
// app/components/site/hero/SceneBoundary.tsx
"use client";

import { Component, type ReactNode } from "react";
import { SceneFallback } from "./SceneFallback";

type SceneBoundaryProps = {
  children: ReactNode;
};

type SceneBoundaryState = {
  hasError: boolean;
};

export class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
  state: SceneBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <SceneFallback />;
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run components/site/hero/SceneBoundary.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd app && git add components/site/hero/SceneBoundary.tsx components/site/hero/SceneBoundary.test.tsx
git commit -m "$(cat <<'EOF'
feat: add SceneBoundary error boundary for the 3D hero

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 7: `WireframeShape` primitive

Not unit-tested (WebGL — see Global Constraints). Verified manually in Task 10.

**Files:**
- Create: `app/components/site/hero/WireframeShape.tsx`

**Interfaces:**
- Consumes: `useSiteTheme` (Task 4), `useFrame` from `@react-three/fiber`.
- Produces: `WireframeShape({ size, detail, spin }: { size?: number; detail?: "full" | "reduced"; spin?: boolean })`. Consumed by Task 8 and Task 9 (must be rendered as a child of an R3F `<Canvas>` — it uses `useFrame`, which throws outside one).

- [ ] **Step 1: Write the implementation**

```tsx
// app/components/site/hero/WireframeShape.tsx
"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Mesh } from "three";
import { useSiteTheme } from "./useSiteTheme";

// Must match app/app/globals.css's --color-accent for each theme.
// WebGL materials can't read CSS custom properties, so this is a manual
// sync point — if the accent token changes, update this too.
const ACCENT_HEX = {
  light: "#187a73",
  dark: "#5ec8c0",
} as const;

type WireframeShapeProps = {
  size?: number;
  detail?: "full" | "reduced";
  spin?: boolean;
};

export function WireframeShape({
  size = 1.4,
  detail = "full",
  spin = true,
}: WireframeShapeProps) {
  const meshRef = useRef<Mesh>(null);
  const theme = useSiteTheme();
  const detailLevel = detail === "full" ? 1 : 0;

  useFrame((_state, delta) => {
    if (!spin || !meshRef.current) return;
    meshRef.current.rotation.x += delta * 0.15;
    meshRef.current.rotation.y += delta * 0.22;
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[size, detailLevel]} />
      <meshBasicMaterial color={ACCENT_HEX[theme]} wireframe />
    </mesh>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd app && git add components/site/hero/WireframeShape.tsx
git commit -m "$(cat <<'EOF'
feat: add WireframeShape 3D primitive

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 8: `HeroScene` (home hero)

Not unit-tested (WebGL). `HeroSceneInner` holds the actual `<Canvas>`; `HeroScene` is the `dynamic()`/`SceneBoundary` wrapper other code imports.

**Files:**
- Create: `app/components/site/hero/HeroSceneInner.tsx`
- Create: `app/components/site/hero/HeroScene.tsx`

**Interfaces:**
- Consumes: `WireframeShape` (Task 7), `useDeviceTier` (Task 2), `usePrefersReducedMotion` (Task 3), `SceneBoundary` (Task 6), `SceneFallback` (Task 5), `Canvas` from `@react-three/fiber`, `dynamic` from `next/dynamic`.
- Produces: `HeroScene()` (no props) — a `240px`-ish decorative square. Consumed by Task 10 (home page).

- [ ] **Step 1: Write `HeroSceneInner`**

```tsx
// app/components/site/hero/HeroSceneInner.tsx
"use client";

import { Canvas } from "@react-three/fiber";
import { WireframeShape } from "./WireframeShape";
import { useDeviceTier } from "./useDeviceTier";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export default function HeroSceneInner() {
  const tier = useDeviceTier();
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <Canvas camera={{ position: [0, 0, 4], fov: 45 }} dpr={[1, 2]}>
      <WireframeShape size={1.6} detail={tier} spin={!prefersReducedMotion} />
    </Canvas>
  );
}
```

(Default export is required here — `next/dynamic`'s `import()` in Step 2 resolves the module's default export.)

- [ ] **Step 2: Write `HeroScene`**

```tsx
// app/components/site/hero/HeroScene.tsx
"use client";

import dynamic from "next/dynamic";
import { SceneBoundary } from "./SceneBoundary";
import { SceneFallback } from "./SceneFallback";

const HeroSceneInner = dynamic(() => import("./HeroSceneInner"), {
  ssr: false,
  loading: () => <SceneFallback />,
});

export function HeroScene() {
  return (
    <div className="h-48 w-48 shrink-0 sm:h-64 sm:w-64">
      <SceneBoundary>
        <HeroSceneInner />
      </SceneBoundary>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS (no test targets these two files directly, per Global Constraints — this confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
cd app && git add components/site/hero/HeroSceneInner.tsx components/site/hero/HeroScene.tsx
git commit -m "$(cat <<'EOF'
feat: add HeroScene 3D hero, dynamically imported with static fallback

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 9: `ProjectAccent` (per-project accent)

Same pattern as Task 8, smaller canvas, reused per `/projects` entry.

**Files:**
- Create: `app/components/site/hero/ProjectAccentInner.tsx`
- Create: `app/components/site/hero/ProjectAccent.tsx`

**Interfaces:**
- Consumes: same as Task 8.
- Produces: `ProjectAccent()` (no props) — a `48px` decorative square. Consumed by Task 11 (`/projects` page).

- [ ] **Step 1: Write `ProjectAccentInner`**

```tsx
// app/components/site/hero/ProjectAccentInner.tsx
"use client";

import { Canvas } from "@react-three/fiber";
import { WireframeShape } from "./WireframeShape";
import { useDeviceTier } from "./useDeviceTier";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

export default function ProjectAccentInner() {
  const tier = useDeviceTier();
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <Canvas camera={{ position: [0, 0, 3], fov: 50 }} dpr={[1, 2]}>
      <WireframeShape size={0.9} detail={tier} spin={!prefersReducedMotion} />
    </Canvas>
  );
}
```

- [ ] **Step 2: Write `ProjectAccent`**

```tsx
// app/components/site/hero/ProjectAccent.tsx
"use client";

import dynamic from "next/dynamic";
import { SceneBoundary } from "./SceneBoundary";
import { SceneFallback } from "./SceneFallback";

const ProjectAccentInner = dynamic(() => import("./ProjectAccentInner"), {
  ssr: false,
  loading: () => <SceneFallback />,
});

export function ProjectAccent() {
  return (
    <div className="h-12 w-12 shrink-0">
      <SceneBoundary>
        <ProjectAccentInner />
      </SceneBoundary>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd app && git add components/site/hero/ProjectAccentInner.tsx components/site/hero/ProjectAccent.tsx
git commit -m "$(cat <<'EOF'
feat: add ProjectAccent 3D accent for project list rows

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 10: Wire `HeroScene` into the home page

**Files:**
- Modify: `app/app/(site)/page.tsx:24-38`
- Modify: `app/app/(site)/page.test.tsx`

**Interfaces:**
- Consumes: `HeroScene` (Task 8).

`HeroScene` is mocked in this page's test — per Global Constraints, WebGL isn't unit-tested, and dynamically importing the real `@react-three/fiber` `Canvas` inside a jsdom test risks an unhandled async error from WebGL-context creation racing the test's assertions. Mocking it keeps this test focused on the page's own content, the same pattern Phase 2's `CommandBar.test.tsx` established for mocking `next/navigation`.

- [ ] **Step 1: Update the test first**

Replace the full contents of `app/app/(site)/page.test.tsx` with:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

vi.mock("../../components/site/hero/HeroScene", () => ({
  HeroScene: () => null,
}));

describe("HomePage", () => {
  it("renders the name as the main heading", () => {
    render(<HomePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Ashutosh Pandey" }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it still passes against the old page**

Run: `cd app && npx vitest run "app/(site)/page.test.tsx"`
Expected: PASS — the mock doesn't change existing behavior yet since `page.tsx` doesn't import `HeroScene` until Step 3.

- [ ] **Step 3: Add `HeroScene` to the hero section**

In `app/app/(site)/page.tsx`, add the import:

```tsx
import Link from "next/link";
import { HeroScene } from "../../components/site/hero/HeroScene";
```

Change the opening `<section>` from:

```tsx
      <section>
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
          Software engineer
        </p>
        <h1 className="mt-4 font-mono text-4xl font-semibold tracking-tight sm:text-5xl">
          Ashutosh Pandey
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-fg/80 sm:text-lg">
          I build small, finished tools end to end — the interface, the signal
          processing underneath it, and the infrastructure it runs on.
        </p>
      </section>
```

to:

```tsx
      <section className="flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
            Software engineer
          </p>
          <h1 className="mt-4 font-mono text-4xl font-semibold tracking-tight sm:text-5xl">
            Ashutosh Pandey
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-fg/80 sm:text-lg">
            I build small, finished tools end to end — the interface, the
            signal processing underneath it, and the infrastructure it runs
            on.
          </p>
        </div>
        <HeroScene />
      </section>
```

- [ ] **Step 4: Run the test to verify it still passes**

Run: `cd app && npx vitest run "app/(site)/page.test.tsx"`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd app && git add "app/(site)/page.tsx" "app/(site)/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat: add 3D hero scene to the home page

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 11: Wire `ProjectAccent` into `/projects`

**Files:**
- Modify: `app/app/(site)/projects/page.tsx` (as rewritten by Phase 2's plan)
- Modify: `app/app/(site)/projects/page.test.tsx`

**Interfaces:**
- Consumes: `ProjectAccent` (Task 9).

Same mocking rationale as Task 10.

- [ ] **Step 1: Update the test first**

Add this mock near the top of `app/app/(site)/projects/page.test.tsx`, alongside the existing imports (keep the two existing `it` blocks from Phase 2's plan unchanged):

```tsx
vi.mock("../../../components/site/hero/ProjectAccent", () => ({
  ProjectAccent: () => null,
}));
```

The full file should now read:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ProjectsPage from "./page";

vi.mock("../../../components/site/hero/ProjectAccent", () => ({
  ProjectAccent: () => null,
}));

describe("ProjectsPage", () => {
  it("lists the BGM Looper project linking to the tool", () => {
    render(<ProjectsPage />);
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
  });

  it("renders inside the terminal window chrome", () => {
    render(<ProjectsPage />);
    expect(screen.getByText("projects — zsh")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it still passes against the old page**

Run: `cd app && npx vitest run "app/(site)/projects/page.test.tsx"`
Expected: PASS — the mock is inert until Step 3 wires it in.

- [ ] **Step 3: Add `ProjectAccent` to each row**

In `app/app/(site)/projects/page.tsx`, add the import:

```tsx
import Link from "next/link";
import { projects } from "../../../content/projects";
import { TerminalWindow } from "../../../components/site/TerminalWindow";
import { ProjectAccent } from "../../../components/site/hero/ProjectAccent";
```

Change the `<li>` body from:

```tsx
              <li key={project.slug}>
                <div className="flex items-baseline gap-2">
                  <span aria-hidden="true" className="text-[var(--color-accent)]">
                    $
                  </span>
                  <Link
                    href={project.href}
                    className="text-base font-semibold text-[var(--color-terminal-fg)] transition-colors hover:text-[var(--color-accent)]"
                  >
                    {project.name}
                  </Link>
                </div>
                <p className="mt-1 pl-4 text-[0.8125rem] leading-relaxed text-[var(--color-terminal-fg)]/70">
                  {project.description}
                </p>
              </li>
```

to:

```tsx
              <li key={project.slug} className="flex items-start gap-4">
                <ProjectAccent />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span aria-hidden="true" className="text-[var(--color-accent)]">
                      $
                    </span>
                    <Link
                      href={project.href}
                      className="text-base font-semibold text-[var(--color-terminal-fg)] transition-colors hover:text-[var(--color-accent)]"
                    >
                      {project.name}
                    </Link>
                  </div>
                  <p className="mt-1 pl-4 text-[0.8125rem] leading-relaxed text-[var(--color-terminal-fg)]/70">
                    {project.description}
                  </p>
                </div>
              </li>
```

- [ ] **Step 4: Run the test to verify it still passes**

Run: `cd app && npx vitest run "app/(site)/projects/page.test.tsx"`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd app && git add "app/(site)/projects/page.tsx" "app/(site)/projects/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat: add per-project 3D accent to the /projects listing

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 12: Manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`

- [ ] **Step 2: Desktop check**

Open `/` and `/projects` at a desktop viewport width. Confirm the wireframe shape renders and rotates slowly in both places, and that its color matches the teal accent in both light and dark theme (toggle to check both).

- [ ] **Step 3: Narrow-viewport check**

Resize the browser (or use DevTools device toolbar) to below 768px width. Confirm the shape still renders (not replaced by the static fallback — device tier only reduces detail, per spec §4) and still rotates.

- [ ] **Step 4: Reduced-motion check**

Enable "reduce motion" (OS setting, or Chrome DevTools Rendering tab → "Emulate CSS media feature prefers-reduced-motion: reduce"). Confirm the shape is still visible but no longer rotating, at both viewport widths from Steps 2-3.

- [ ] **Step 5: Bundle-split check**

Run: `cd app && npm run build`

In the build output, confirm `/` and `/projects` do not show `three`/`@react-three/fiber` inlined into their main route chunk sizes — they should appear as a separately-loaded chunk (the `dynamic(..., { ssr: false })` wrapping from Tasks 8-9 is what causes this split).

- [ ] **Step 6: Stop the dev server**

Ctrl+C in the terminal running `npm run dev`.

No commit for this task — verification only. If any step surfaces a problem, fix it in the relevant task's files, re-run that task's tests, then repeat this task's steps.

---

## Self-Review Notes

- **Spec coverage:** §3 (`WireframeShape`) → Task 7. §4 (device tier / reduced motion, kept as separate axes) → Tasks 2-3, consumed distinctly in Tasks 8-9 (`detail={tier}` vs `spin={!prefersReducedMotion}` are separate props, never merged). §5 (loading strategy, `SceneFallback` covering load/no-WebGL/error, NOT reduced-motion) → Tasks 5-6, 8-9; confirmed `SceneFallback` is never rendered for the reduced-motion case in `HeroSceneInner`/`ProjectAccentInner` — only `WireframeShape`'s own `spin` prop responds to it. §6 (manual verification, bundle-split check) → Task 12. §7 (no Drei, no GSAP, no per-project scene variety) → confirmed: `package.json` changes in Task 1 add only `three`/`@react-three/fiber`; every `ProjectAccent` instance renders the same `WireframeShape`, just smaller.
- **Type consistency:** `DeviceTier = "full" | "reduced"` (Task 2) matches the `detail` prop type on `WireframeShape` (Task 7) and the values passed in Tasks 8-9. `SiteTheme = "light" | "dark"` (Task 4) matches the keys of `ACCENT_HEX` (Task 7).
- **No placeholders:** every file above is complete, real code. The theme-color sync point (`ACCENT_HEX` vs `globals.css`) is explicitly called out rather than silently assumed correct.

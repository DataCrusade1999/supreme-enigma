# Storybook + Chromatic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `web/components/` an isolated render surface (Storybook) and automated visual regression (Chromatic) on every PR into `dev`, with all build cost paid by CI.

**Architecture:** Storybook 10.6 with the `@storybook/nextjs-vite` framework reuses the Vite toolchain Vitest already runs on. Two preview decorators reproduce what `app/layout.tsx` gives the real app and a story would otherwise lack — the `next/font` `.variable` classes on `<html>`, and the theme, applied through the site's own `setTheme` from `lib/site/theme.ts` so `ThemeToggle` sees the same class and event it sees in production. Chromatic's GitHub Action builds Storybook on its own runner in a job parallel to `test`, snapshotting every story in light and dark via `parameters.chromatic.modes`.

**Tech Stack:** Storybook 10.6 (`@storybook/nextjs-vite`), `@chromatic-com/storybook` 5.3, `chromaui/action@v18`, Next 16, React 19, Vite 6, Vitest 4, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-09-18-storybook-chromatic-design.md`

**Issue:** #209 — the PR closes it with `Closes #209`.

**Branch:** `feat/storybook-chromatic`, which already exists locally: it is `origin/dev` plus one docs commit (`0763186`, the `setTheme` revision of the spec and this plan) that is not on `dev`. **Work on that branch as it is** — do not re-cut it from `origin/dev`, which would drop that commit. The branch is pushed and tracks `origin/feat/storybook-chromatic`, and PR #211 (docs only, `Refs #209`) is open on it. The implementation lands on this same branch: once #211 merges, rebase onto `dev` or wait for it, then push normally. #210 deleted the earlier remote branch, so there is no stale history to force over.

## Global Constraints

- All commands run from `E:\Personal\looper\web` unless stated otherwise.
- **Never add `storybook` or `build-storybook` to `npm test`, `npm run lint`, or any hook.** Storybook is installed locally but only run on demand. This is the whole point of the change.
- Exact dependency versions: `storybook@^10.6.0`, `@storybook/nextjs-vite@^10.6.0`, `@chromatic-com/storybook@^5.3.1`, `chromatic@^18.9.4` (all four verified to exist at exactly these versions on 2026-09-18). Do not run `npx storybook init` — it is interactive and rewrites files. Install and hand-write the config.
- **The `next/font` `.variable` classes and the `dark` class go on `document.documentElement`, never on a wrapper `<div>`.** `@theme` emits `--font-display: var(--font-instrument-serif), serif` on `:root`; a custom property resolves its inner `var()` on the declaring element, so a wrapper leaves `--font-display` already collapsed to `serif` and every snapshot renders in the fallback. Spec §7.2.
- **Do not import `next/font/google` from any file Vitest loads.** It is a build-time SWC transform and throws under Vitest. `preview.tsx` imports it; `decorators.tsx` must not, which is why the decorator takes class names as an argument.
- **The theme is applied with `setTheme` from `lib/site/theme.ts`, not with `@storybook/addon-themes`.** The spec named `withThemeByClassName`; it is dropped here for a reason checked against the addon's shipped 10.6.0 source. That decorator adds the class inside a `useEffect` from `storybook/preview-api`, which fires *after* the story has rendered to the canvas. `ThemeToggle` reads `documentElement.classList.contains("dark")` in a React mount effect and re-reads only on `THEME_CHANGE_EVENT`, so on a fresh dark-mode load it would read the class before the addon writes it, show the light-mode icon on a dark page, and `autoAcceptChanges: dev` would lock that in — the spec's own "confident, wrong baseline" failure. `setTheme` toggles the class *and* dispatches the event the toggle already listens for, and it is the exact code path the site uses. The toolbar switcher comes from a plain `globalTypes.theme` entry, which is also the global Chromatic's modes set. Theme values: `"light"` / `"dark"`, default `"dark"` (the site default, per `app/layout.tsx`).
- `web/tsconfig.json` includes `**/*.tsx`, so `next build` — locally and on Vercel — typechecks every story file: a type error in a story fails the Vercel build, not just Storybook. That glob does **not** reach `.storybook/` — TypeScript's `**` skips dot-directories (verified with `tsc --listFilesOnly`), and neither Vitest nor the Vite builder typechecks — so Task 1 adds `.storybook/**/*.ts(x)` to `include` explicitly. Vitest, by contrast, does collect tests under dot-directories, which is why `.storybook/decorators.test.tsx` runs under `npm test` with no config change.
- Story files are colocated: `components/**/*.stories.tsx`.
- `CHANGELOG.md` (repo root) gets its entry under `## [Unreleased]` in this same branch.
- Every commit message ends with `Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>`.
- Do not touch `infra/` — the Vercel `ignore_command` is deliberately left alone (spec §3).

## File Structure

**Create:**
- `web/.storybook/main.ts` — framework, stories glob, addons. ~12 lines.
- `web/.storybook/decorators.tsx` — the real logic: put class names on `<html>` for the life of a story, and apply the theme through `setTheme`. No `next/font` import, unit-tested.
- `web/.storybook/decorators.test.tsx` — proves the classes land on `documentElement` and are cleaned up, and that the theme decorator toggles `dark` and fires `THEME_CHANGE_EVENT`.
- `web/.storybook/preview.tsx` — imports `globals.css`, declares the two fonts, declares the `theme` global, wires the decorators, sets the Chromatic modes.
- `web/components/**/*.stories.tsx` — 17 files, one per component.

**Modify:**
- `.github/workflows/deploy.yml` — new `chromatic` job.
- `web/package.json` — 4 devDependencies, 2 scripts.
- `web/tsconfig.json` — `.storybook/**` added to `include`.
- `web/.gitignore` — `storybook-static/`.
- `web/eslint.config.mjs` — ignore `storybook-static/**`.
- `CHANGELOG.md` — one entry under `[Unreleased]`.

**Why `decorators.tsx` is separate from `preview.tsx`:** `preview.tsx` cannot be unit-tested (it imports `next/font/google` and Tailwind CSS). Splitting the DOM logic out makes the one thing that can silently break — the `<html>` target — testable in jsdom under the existing Vitest run.

---

### Task 1: Install Storybook and get an empty build passing

**Files:**
- Modify: `web/package.json`
- Modify: `web/.gitignore`
- Modify: `web/eslint.config.mjs`
- Modify: `web/tsconfig.json`
- Create: `web/.storybook/main.ts`
- Create: `web/components/site/TerminalWindow.stories.tsx` (one story, so the build has something to index)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run build-storybook` as a working command; `.storybook/main.ts` exporting a default `StorybookConfig`.

- [ ] **Step 1: Install the dependencies**

```bash
cd web
npm install --save-dev storybook@^10.6.0 @storybook/nextjs-vite@^10.6.0 @chromatic-com/storybook@^5.3.1 chromatic@^18.9.4
```

Expected: installs clean. `@storybook/nextjs-vite@10.6` declares `next: ^14.1.0 || ^15.0.0 || ^16.0.0`, `react: ^16.8 – ^19`, `vite: ^5 – ^8`, so the repo's `next@16.3.4` / `react@19` / `vite@6.4.3` all satisfy it — **there must be no peer-dependency error and `vite` must not be upgraded.** If npm proposes bumping `vite`, stop and report it rather than accepting.

- [ ] **Step 2: Add the scripts**

In `web/package.json`, add to `"scripts"`, after `"lint"`:

```json
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
```

Do not touch `"test"` or `"lint"`.

- [ ] **Step 3: Ignore the build output**

Append to `web/.gitignore`, after the Playwright/Vitest block:

```
# Storybook static build
storybook-static/
```

Then, in `web/eslint.config.mjs`, extend the existing `ignores` array:

```js
    ignores: ["next-env.d.ts", ".next/**", "storybook-static/**"],
```

`npm run lint` is `eslint .`, and ESLint's flat config does not read `.gitignore`. Without this, the first local `build-storybook` leaves a bundle that every later `npm run lint` walks. `.storybook/` itself is *not* ignored — flat config lints dot-directories, and the decorators should be linted.

Then, in `web/tsconfig.json`, extend `include` so `next build` typechecks the Storybook config too (its `**/*.tsx` glob skips dot-directories):

```json
  "include": [
    "**/*.ts",
    "**/*.tsx",
    ".storybook/**/*.ts",
    ".storybook/**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
```

- [ ] **Step 4: Write `.storybook/main.ts`**

```ts
import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  // Colocated with the components, the same place *.test.tsx lives.
  stories: ["../components/**/*.stories.tsx"],
  addons: [
    // Visual-test addon: surfaces Chromatic changes in the Storybook UI.
    "@chromatic-com/storybook",
  ],
  framework: "@storybook/nextjs-vite",
  // No staticDirs — there is no web/public directory in this repo.
};

export default config;
```

- [ ] **Step 5: Write one story so the build has an entry**

Create `web/components/site/TerminalWindow.stories.tsx`:

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TerminalWindow } from "./TerminalWindow";

const meta = {
  title: "Site/TerminalWindow",
  component: TerminalWindow,
} satisfies Meta<typeof TerminalWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "bgm-looper — zsh",
    children: (
      <>
        <p>$ npm run build-storybook</p>
        <p>info =&gt; Building manager..</p>
      </>
    ),
  },
};
```

- [ ] **Step 6: Verify the build passes**

Run: `cd web && npm run build-storybook`
Expected: exits 0, writes `storybook-static/`. There is no theme or font handling yet — that is Task 2 — so do not judge the rendering.

- [ ] **Step 7: Verify nothing else broke**

Run: `cd web && npm test && npm run lint`
Expected: both pass. Specifically confirm Vitest does **not** collect `TerminalWindow.stories.tsx` as a test file — its default include is `**/*.{test,spec}.*`, so a `.stories.tsx` must not appear in the run. If it does, stop and report; do not paper over it by editing `vitest.config.ts`'s `exclude` (that list is load-bearing, see `.claude/rules/web.md`).

- [ ] **Step 8: Commit**

```bash
cd /e/Personal/looper
git add web/package.json web/package-lock.json web/.gitignore web/eslint.config.mjs web/tsconfig.json web/.storybook/main.ts web/components/site/TerminalWindow.stories.tsx
git commit -m "chore(web): add Storybook with the nextjs-vite framework

Config only, plus one story so the build has something to index. No
theme or font handling yet. Neither storybook script is wired into
npm test or npm run lint.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 2: Theme and font decorators (the part that makes snapshots truthful)

**Files:**
- Create: `web/.storybook/decorators.tsx`
- Create: `web/.storybook/decorators.test.tsx`
- Create: `web/.storybook/preview.tsx`

**Interfaces:**
- Consumes: `.storybook/main.ts` from Task 1.
- Produces:
  - `HtmlClasses({ classes: string[], children: React.ReactNode }): JSX.Element` — adds `classes` to `document.documentElement` while mounted, removes them on unmount.
  - `makeHtmlClassDecorator(classNames: string[]): Decorator` — the same, packaged as a Storybook decorator.
  - `SiteTheme({ theme: "light" | "dark", children }): JSX.Element` — calls `setTheme(theme)` in an effect, so `dark` lands on `<html>` and `THEME_CHANGE_EVENT` fires exactly as on the site.
  - `withSiteTheme: Decorator` — reads `context.globals.theme` and renders `SiteTheme`.
  - `.storybook/preview.tsx` default export, consumed by Storybook only.

This is the task the spec calls out as the failure mode that looks correct and is not. The tests pin the two things that can silently go wrong: the `<html>` target for the font variables, and the theme reaching `ThemeToggle` after it has mounted (see Global Constraints for why the addon could not do that).

- [ ] **Step 1: Write the failing test**

Create `web/.storybook/decorators.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { THEME_CHANGE_EVENT } from "../lib/site/theme";
import { HtmlClasses, SiteTheme, makeHtmlClassDecorator, withSiteTheme } from "./decorators";

// Stand-ins for the hashed class names next/font generates (e.g.
// "__variable_1e4310"). The real values come from preview.tsx; this module
// must never import next/font itself — it is a build-time SWC transform and
// throws under Vitest.
const FONT_CLASSES = ["__variable_display", "__variable_ui"];

describe("HtmlClasses", () => {
  it("puts the classes on documentElement, not on a wrapper element", () => {
    const { container } = render(
      <HtmlClasses classes={FONT_CLASSES}>
        <p>story</p>
      </HtmlClasses>,
    );

    // The target is load-bearing: @theme declares
    // --font-display: var(--font-instrument-serif), serif on :root, and a
    // custom property resolves its inner var() on the declaring element. Put
    // these classes on a wrapper and --font-display has already collapsed to
    // `serif` on :root — every snapshot silently renders the fallback stack.
    for (const className of FONT_CLASSES) {
      expect(document.documentElement.classList.contains(className)).toBe(true);
      expect(container.querySelector(`.${className}`)).toBeNull();
    }
  });

  it("removes the classes when the story unmounts", () => {
    const { unmount } = render(
      <HtmlClasses classes={FONT_CLASSES}>
        <p>story</p>
      </HtmlClasses>,
    );

    unmount();

    for (const className of FONT_CLASSES) {
      expect(document.documentElement.classList.contains(className)).toBe(false);
    }
  });

  it("leaves classes it did not add alone", () => {
    document.documentElement.classList.add("dark");

    const { unmount } = render(
      <HtmlClasses classes={FONT_CLASSES}>
        <p>story</p>
      </HtmlClasses>,
    );
    unmount();

    // SiteTheme owns `dark`. Stripping it on unmount would make
    // every story after the first render in light mode.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    document.documentElement.classList.remove("dark");
  });
});

describe("makeHtmlClassDecorator", () => {
  it("wraps a story so the classes reach documentElement", () => {
    const decorator = makeHtmlClassDecorator(FONT_CLASSES);
    function Wrapped() {
      return <>{decorator(() => <p>story</p>, {} as never)}</>;
    }

    render(<Wrapped />);

    expect(document.documentElement.classList.contains("__variable_display")).toBe(true);
  });
});

describe("SiteTheme", () => {
  it("puts dark on documentElement and fires the theme event after children mount", () => {
    // ThemeToggle reads the class in its own mount effect and re-reads on this
    // event. A parent's effect runs after a child's, so the event is what
    // makes the toggle's icon match the page in a fresh dark-mode load.
    const onChange = vi.fn();
    window.addEventListener(THEME_CHANGE_EVENT, onChange);

    render(
      <SiteTheme theme="dark">
        <p>story</p>
      </SiteTheme>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  });

  it("removes dark for the light theme", () => {
    document.documentElement.classList.add("dark");

    render(
      <SiteTheme theme="light">
        <p>story</p>
      </SiteTheme>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("withSiteTheme", () => {
  it("reads the theme global, defaulting to dark", () => {
    document.documentElement.classList.remove("dark");
    function Wrapped() {
      return <>{withSiteTheme(() => <p>story</p>, { globals: {} } as never)}</>;
    }

    render(<Wrapped />);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    document.documentElement.classList.remove("dark");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run .storybook/decorators.test.tsx`
Expected: FAIL — `Failed to resolve import "./decorators"`.

- [ ] **Step 3: Write `.storybook/decorators.tsx`**

```tsx
import { useEffect } from "react";
import type { Decorator } from "@storybook/nextjs-vite";
import { setTheme } from "../lib/site/theme";

/**
 * Adds class names to <html> for as long as a story is mounted.
 *
 * The target is not incidental. app/globals.css declares
 * `--font-display: var(--font-instrument-serif), serif` inside @theme, which
 * Tailwind emits on :root. A custom property resolves its inner var() at
 * computed-value time on the element that declares it, and descendants inherit
 * the already-computed result — so defining --font-instrument-serif on a
 * wrapper <div> is too late, and --font-display has already fallen back to
 * `serif`. app/layout.tsx puts the same classes on <html> for the same reason.
 */
export function HtmlClasses({
  classes,
  children,
}: {
  classes: string[];
  children: React.ReactNode;
}) {
  useEffect(() => {
    const html = document.documentElement;
    // Only remove what we added: SiteTheme owns `dark` on the same
    // element, and clobbering it would leave every story after the first in
    // light mode.
    const added = classes.filter((name) => name && !html.classList.contains(name));
    html.classList.add(...added);
    return () => html.classList.remove(...added);
  }, [classes]);

  return <>{children}</>;
}

export function makeHtmlClassDecorator(classNames: string[]): Decorator {
  const classes = classNames.filter(Boolean);
  return (Story) => (
    <HtmlClasses classes={classes}>
      <Story />
    </HtmlClasses>
  );
}

/**
 * Applies the theme the way the site does: setTheme toggles `dark` on <html>
 * and dispatches THEME_CHANGE_EVENT. Deliberately not @storybook/addon-themes —
 * its withThemeByClassName writes the class from a storybook/preview-api
 * useEffect, which fires after the story has rendered, so ThemeToggle's
 * mount-time read of the class would see the previous theme and nothing would
 * tell it to look again. This runs as a parent effect (after the toggle's own
 * mount effect) and the event is what brings the toggle back in sync.
 */
export function SiteTheme({
  theme,
  children,
}: {
  theme: "light" | "dark";
  children: React.ReactNode;
}) {
  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  return <>{children}</>;
}

export const withSiteTheme: Decorator = (Story, context) => (
  <SiteTheme theme={context.globals.theme === "light" ? "light" : "dark"}>
    <Story />
  </SiteTheme>
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run .storybook/decorators.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write `.storybook/preview.tsx`**

```tsx
import type { Preview } from "@storybook/nextjs-vite";
import { IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import { makeHtmlClassDecorator, withSiteTheme } from "./decorators";
import "../app/globals.css";

// Same two faces, same weights and fallbacks as app/layout.tsx. Declared here
// too because a story never renders the root layout, and globals.css points
// --font-display/--font-ui at the variables these write.
const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const ibmPlexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
  fallback: [
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
});

const preview: Preview = {
  // The toolbar switcher. Chromatic's modes below set this same global, so one
  // story export is captured once per theme.
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: {
        title: "Theme",
        icon: "contrast",
        items: ["light", "dark"],
        dynamicTitle: true,
      },
    },
  },
  // The site default, per app/layout.tsx.
  initialGlobals: { theme: "dark" },
  parameters: {
    // globals.css sets html { background-color: var(--color-bg) }, so the
    // canvas already tracks the theme. Storybook's own backgrounds addon would
    // paint over it.
    backgrounds: { disable: true },
    // Two snapshots per story from one export. Chromatic's docs factor these
    // into a separate .storybook/modes.ts; inlined here because there are two
    // modes and one consumer.
    chromatic: {
      modes: {
        light: { theme: "light" },
        dark: { theme: "dark" },
      },
    },
  },
  decorators: [
    // Font variables on <html> — see decorators.tsx for why the target matters.
    makeHtmlClassDecorator([instrumentSerif.variable, ibmPlexSans.variable]),
    // `dark` on <html> via lib/site/theme.ts's setTheme — see decorators.tsx
    // for why this is not @storybook/addon-themes.
    withSiteTheme,
    // Presentation padding and the base text colour. Safe on a wrapper — only
    // the custom-property *declarations* above have to be on :root.
    (Story) => (
      <div className="bg-bg p-8 font-ui text-fg">
        <Story />
      </div>
    ),
  ],
};

export default preview;
```

- [ ] **Step 6: Verify the build still passes with the preview wired in**

Run: `cd web && npm run build-storybook`
Expected: exits 0. A failure here is most likely `next/font/google` — confirm `@storybook/nextjs-vite` is the framework in `main.ts`, since the plain Vite builder does not handle that import.

- [ ] **Step 7: Verify by eye, once**

Run: `cd web && npm run storybook`
Open <http://localhost:6006>, select `Site/TerminalWindow → Default`, and check:
- The toolbar has a `Theme` switcher; switching to `light` turns the canvas background from `#131311` to `#eceae5`. If it does not, `withSiteTheme` is not reading the global.
- In DevTools, `<html>` carries **three** classes in dark mode — `dark` plus the two hashed `__variable_*` names. Two classes means the font decorator is on the wrong element.

The computed-font check the spec asks for (§8.2) needs a display-font element, which `TerminalWindow` lacks — it is done in Task 3 Step 10 on `PageMasthead`. Stop the server.

- [ ] **Step 8: Run the full suite**

Run: `cd web && npm test && npm run lint`
Expected: both pass, Vitest includes `.storybook/decorators.test.tsx`.

- [ ] **Step 9: Commit**

```bash
cd /e/Personal/looper
git add web/.storybook/decorators.tsx web/.storybook/decorators.test.tsx web/.storybook/preview.tsx
git commit -m "feat(web): give Storybook the app's fonts and theme class

A story never renders app/layout.tsx, so it inherits neither the
next/font .variable classes nor the dark class. Both now go on
documentElement via decorators — the target is load-bearing, since
@theme resolves --font-display's inner var() on :root and a wrapper
would leave every story on the fallback stack. The theme goes through
lib/site/theme.ts's setTheme rather than addon-themes, whose class
lands after the story renders and so after ThemeToggle has read it.
Both pinned by tests.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 3: Stories for the 10 `site/` components

**Files:**
- Modify: `web/components/site/TerminalWindow.stories.tsx` (already created in Task 1 — leave as is, it counts as one of the ten)
- Create: `web/components/site/CommandBar.stories.tsx`
- Create: `web/components/site/FeaturedTool.stories.tsx`
- Create: `web/components/site/GridBackdrop.stories.tsx`
- Create: `web/components/site/LoopRing.stories.tsx`
- Create: `web/components/site/PageMasthead.stories.tsx`
- Create: `web/components/site/ProjectDemoGif.stories.tsx`
- Create: `web/components/site/SiteFooter.stories.tsx`
- Create: `web/components/site/SiteHeader.stories.tsx`
- Create: `web/components/site/ThemeToggle.stories.tsx`

**Interfaces:**
- Consumes: `.storybook/preview.tsx` decorators from Task 2 (applied globally — no story repeats them).
- Produces: 10 story files under `title: "Site/<Component>"`.

Three components need more than `args`, for reasons given inline: `CommandBar` renders nothing until an event fires, `GridBackdrop` is absolutely positioned, and `ProjectDemoGif` needs an image that is not a network fetch.

- [ ] **Step 1: `PageMasthead.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageMasthead } from "./PageMasthead";

const meta = {
  title: "Site/PageMasthead",
  component: PageMasthead,
} satisfies Meta<typeof PageMasthead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { eyebrow: "Writing", title: "Blog" },
};

export const WithRightSlot: Story = {
  args: {
    eyebrow: "Career",
    title: "Resume",
    right: (
      <a className="text-[0.6875rem] uppercase tracking-[0.16em] text-accent" href="#">
        Download PDF
      </a>
    ),
  },
};

// The title is the largest type on the site (5.25rem at sm). Worth its own
// snapshot: the wrap is where a font or leading regression shows first.
export const LongTitle: Story = {
  args: { eyebrow: "Tools", title: "Background Music Looper" },
};
```

- [ ] **Step 2: `FeaturedTool.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FeaturedTool } from "./FeaturedTool";
import { projects } from "../../content/projects";

const meta = {
  title: "Site/FeaturedTool",
  component: FeaturedTool,
} satisfies Meta<typeof FeaturedTool>;

export default meta;
type Story = StoryObj<typeof meta>;

// The real project data, the same fixture FeaturedTool.test.tsx uses. A second
// set of sample copy would drift from what the home page actually renders.
export const Default: Story = {
  args: { project: projects[0] },
};

export const ShortDescription: Story = {
  args: {
    project: {
      slug: "example",
      name: "Example",
      description: "One line.",
      href: "/tools/example",
    },
  },
};
```

- [ ] **Step 3: `SiteHeader.stories.tsx` and `SiteFooter.stories.tsx`**

```tsx
// SiteHeader.stories.tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SiteHeader } from "./SiteHeader";

const meta = {
  title: "Site/SiteHeader",
  component: SiteHeader,
} satisfies Meta<typeof SiteHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

// Takes no props. The nav list and the ThemeToggle are both internal, so one
// story covers it — the value is the diff, not the variants.
export const Default: Story = {};
```

```tsx
// SiteFooter.stories.tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SiteFooter } from "./SiteFooter";

const meta = {
  title: "Site/SiteFooter",
  component: SiteFooter,
} satisfies Meta<typeof SiteFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

// Renders `© {new Date().getFullYear()}`, so this snapshot will diff once a
// year on 1 January. Accepted rather than mocked: a frozen date here would be
// one more thing to keep in sync with the component.
export const Default: Story = {};
```

- [ ] **Step 4: `ThemeToggle.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ThemeToggle } from "./ThemeToggle";

const meta = {
  title: "Site/ThemeToggle",
  component: ThemeToggle,
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

// The component reads document.documentElement.classList.contains("dark") on
// mount and re-reads on THEME_CHANGE_EVENT. withSiteTheme's setTheme call
// fires that event after this mount, so each Chromatic mode shows the icon
// that matches its page — the two modes exercise both icon states from this
// single story.
export const Default: Story = {};
```

- [ ] **Step 5: `LoopRing.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LoopRing } from "./LoopRing";

const meta = {
  title: "Site/LoopRing",
  component: LoopRing,
} satisfies Meta<typeof LoopRing>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoSeam: Story = {
  args: { seam: false },
};

export const Small: Story = {
  args: { radius: 56, scale: 0.3 },
};
```

- [ ] **Step 6: `GridBackdrop.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GridBackdrop } from "./GridBackdrop";

const meta = {
  title: "Site/GridBackdrop",
  component: GridBackdrop,
  decorators: [
    // The component is `absolute inset-0 -z-10`, so on its own it collapses to
    // nothing and snapshots as an empty frame. It needs a positioned ancestor
    // with real height, which on the site is the page shell.
    (Story) => (
      <div className="relative h-80 w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GridBackdrop>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
```

- [ ] **Step 7: `ProjectDemoGif.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectDemoGif } from "./ProjectDemoGif";

const meta = {
  title: "Site/ProjectDemoGif",
  component: ProjectDemoGif,
} satisfies Meta<typeof ProjectDemoGif>;

export default meta;
type Story = StoryObj<typeof meta>;

// An inline SVG data URI, not a file or a URL. There is no web/public in this
// repo, and a remote image would make every Chromatic snapshot depend on a
// network fetch completing before capture.
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">' +
      '<rect width="640" height="360" fill="#146b64"/>' +
      '<text x="320" y="190" font-family="monospace" font-size="28" fill="#eceae5" text-anchor="middle">demo.gif</text>' +
      "</svg>",
  );

export const Default: Story = {
  args: {
    src: PLACEHOLDER,
    alt: "BGM Looper demo recording",
    width: 640,
    height: 360,
  },
};

export const Priority: Story = {
  args: {
    src: PLACEHOLDER,
    alt: "BGM Looper demo recording",
    width: 640,
    height: 360,
    priority: true,
  },
};
```

- [ ] **Step 8: `CommandBar.stories.tsx`**

```tsx
import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CommandBar, openCommandBar } from "./CommandBar";

const meta = {
  title: "Site/CommandBar",
  component: CommandBar,
} satisfies Meta<typeof CommandBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Closed, the component renders nothing at all — a snapshot of it is a blank
// frame that would happily stay green through any regression. Opening it needs
// the same event ⌘K dispatches; a named component so React and ESLint both see
// a legitimate hook call site.
function OpenOnMount({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    openCommandBar();
  }, []);
  return <>{children}</>;
}

export const Open: Story = {
  decorators: [
    (Story) => (
      <OpenOnMount>
        <Story />
      </OpenOnMount>
    ),
  ],
};
```

- [ ] **Step 9: Verify the build indexes all ten**

Run: `cd web && npm run build-storybook`
Expected: exits 0. Then confirm the count:

```bash
cd web && node -e "const i=require('./storybook-static/index.json');const t=new Set(Object.values(i.entries).map(e=>e.title));console.log([...t].sort().join('\n'));console.log('components:',t.size)"
```

Expected: `components: 10`, all prefixed `Site/`.

- [ ] **Step 10: Check the three special cases actually render**

Run: `cd web && npm run storybook`, then confirm by eye:
- `Site/CommandBar → Open` shows the terminal dialog, not an empty canvas.
- `Site/GridBackdrop → Default` shows 12 vertical rules, not an empty frame.
- `Site/ProjectDemoGif → Default` shows the teal placeholder, not a broken-image icon.
- `Site/ThemeToggle → Default` in dark mode shows the sun icon (the state the click would leave), and the moon after switching the toolbar to `light`. A moon on a dark canvas means the theme reached `<html>` after the toggle read it.

Any of these rendering empty means the story is snapshotting nothing and would never fail.

Then the spec's font check (§8.2), on `Site/PageMasthead → Default`, in the DevTools console of the preview iframe:

```js
getComputedStyle(document.querySelector("h1")).fontFamily
```

Expected: starts with a hashed `__Instrument_Serif_…` family, not `Georgia`. `Georgia` means `--font-display` collapsed to its fallback on `:root` — the font decorator is not reaching `<html>`. Stop the server.

- [ ] **Step 11: Run the full suite and commit**

```bash
cd web && npm test && npm run lint
cd /e/Personal/looper
git add web/components/site/
git commit -m "test(web): add Storybook stories for the site components

Ten components under Site/. CommandBar opens on mount (closed, it
renders nothing and would snapshot a blank frame), GridBackdrop gets a
positioned ancestor, and ProjectDemoGif uses an inline data URI rather
than a network fetch.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 4: Stories for the 7 `blog/` and `newsletter/` components

**Files:**
- Create: `web/components/blog/BlogList.stories.tsx`
- Create: `web/components/blog/PostBody.stories.tsx`
- Create: `web/components/newsletter/IssueList.stories.tsx`
- Create: `web/components/newsletter/IssueBody.stories.tsx`
- Create: `web/components/newsletter/IssueRail.stories.tsx`
- Create: `web/components/newsletter/SubscribeForm.stories.tsx`
- Create: `web/components/newsletter/SendButton.stories.tsx`

**Interfaces:**
- Consumes: `.storybook/preview.tsx` decorators from Task 2; the `BlogListPost`, `IssueListItem` and `IssueNeighbour` types exported by the components themselves.
- Produces: 7 story files under `title: "Blog/<Component>"` and `title: "Newsletter/<Component>"`. Total across Tasks 3 and 4: **17**.

- [ ] **Step 1: `BlogList.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BlogList, type BlogListPost } from "./BlogList";

const meta = {
  title: "Blog/BlogList",
  component: BlogList,
} satisfies Meta<typeof BlogList>;

export default meta;
type Story = StoryObj<typeof meta>;

const posts: BlogListPost[] = [
  {
    slug: "seamless-loops",
    title: "Finding a seamless loop point",
    date: "2026-08-14",
    summary:
      "Beat-aligned cut points, equal-power crossfades, and why the naive approach clicks.",
    tags: ["dsp", "python"],
  },
  {
    slug: "lambda-containers",
    title: "Shipping ffmpeg in a Lambda container image",
    date: "2026-07-02",
    summary: "A static build, a 250MB budget, and one very slow cold start.",
    tags: ["aws", "lambda"],
  },
];

export const Default: Story = {
  args: { posts },
};

// The row is a 12-column grid with the title spanning 7. A long title is where
// the wrap and the hover-rule alignment break first.
export const LongTitle: Story = {
  args: {
    posts: [
      {
        ...posts[0],
        title:
          "Why the loop point has to land on a beat boundary and not merely a zero crossing",
      },
    ],
  },
};

// The page renders the list unconditionally, so the empty case is reachable.
export const Empty: Story = {
  args: { posts: [] },
};
```

- [ ] **Step 2: `PostBody.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PostBody } from "./PostBody";

const meta = {
  title: "Blog/PostBody",
  component: PostBody,
} satisfies Meta<typeof PostBody>;

export default meta;
type Story = StoryObj<typeof meta>;

// PostBody takes already-rendered children — Markdoc runs upstream — so a
// couple of paragraphs are a faithful stand-in, not a simplification.
export const Default: Story = {
  args: {
    title: "Finding a seamless loop point",
    date: "2026-08-14",
    children: (
      <>
        <p>
          A loop is seamless when the tail already sounds like the head. That is
          a statement about phase as much as amplitude.
        </p>
        <p>
          The naive approach cuts at a zero crossing and crossfades linearly,
          which drops 3dB through the overlap and reads as a dip.
        </p>
      </>
    ),
  },
};
```

- [ ] **Step 3: `IssueList.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IssueList, type IssueListItem } from "./IssueList";

const meta = {
  title: "Newsletter/IssueList",
  component: IssueList,
} satisfies Meta<typeof IssueList>;

export default meta;
type Story = StoryObj<typeof meta>;

const issues: IssueListItem[] = [
  {
    slug: "issue-002",
    title: "What a slow machine teaches you about CI",
    date: "2026-09-01",
    summary: "Moving every expensive loop off the laptop, one job at a time.",
  },
  {
    slug: "issue-001",
    title: "Shipping the looper",
    date: "2026-08-01",
    summary: "Three branches, three Lambdas, one ECR repo.",
  },
];

export const Default: Story = {
  args: { issues },
};

// Rows span to column 12 here rather than stopping at 9 like BlogList — there
// is no tag column. Worth its own long-title story for that reason.
export const LongTitle: Story = {
  args: {
    issues: [
      {
        ...issues[0],
        title:
          "What a slow development machine teaches you about where the expensive work belongs",
      },
    ],
  },
};

export const Empty: Story = {
  args: { issues: [] },
};
```

- [ ] **Step 4: `IssueBody.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IssueBody } from "./IssueBody";
import { IssueRail } from "./IssueRail";

const meta = {
  title: "Newsletter/IssueBody",
  component: IssueBody,
} satisfies Meta<typeof IssueBody>;

export default meta;
type Story = StoryObj<typeof meta>;

const children = (
  <>
    <p>
      The laptop is slow. That is not a complaint, it is a constraint, and it
      turns out to be a useful one.
    </p>
    <p>Every loop worth running more than twice belongs on someone else&apos;s computer.</p>
  </>
);

export const WithRail: Story = {
  args: {
    title: "What a slow machine teaches you about CI",
    date: "2026-09-01",
    children,
    rail: (
      <IssueRail
        sentDate="1 September 2026"
        newer={null}
        older={{ slug: "issue-001", title: "Shipping the looper", date: "2026-08-01" }}
      />
    ),
  },
};

// The rail is optional and the reading column reflows to full width without it.
export const WithoutRail: Story = {
  args: {
    title: "What a slow machine teaches you about CI",
    date: "2026-09-01",
    children,
  },
};
```

- [ ] **Step 5: `IssueRail.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IssueRail } from "./IssueRail";

const meta = {
  title: "Newsletter/IssueRail",
  component: IssueRail,
} satisfies Meta<typeof IssueRail>;

export default meta;
type Story = StoryObj<typeof meta>;

const newer = { slug: "issue-003", title: "Three branches", date: "2026-10-01" };
const older = { slug: "issue-001", title: "Shipping the looper", date: "2026-08-01" };

export const BothNeighbours: Story = {
  args: { sentDate: "1 September 2026", newer, older },
};

// The newest issue: the component filters nulls out of the neighbour list, so
// this is the layout the most-recent issue actually gets.
export const NewestIssue: Story = {
  args: { sentDate: "1 October 2026", newer: null, older },
};

export const OnlyIssue: Story = {
  args: { sentDate: "1 August 2026", newer: null, older: null },
};
```

- [ ] **Step 6: `SubscribeForm.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SubscribeForm } from "./SubscribeForm";

const meta = {
  title: "Newsletter/SubscribeForm",
  component: SubscribeForm,
} satisfies Meta<typeof SubscribeForm>;

export default meta;
type Story = StoryObj<typeof meta>;

// The two variants are a real layout fork — side by side at page width,
// stacked in the rail, because a 44px field and a 44px button will not both
// fit across four columns. Both need snapshots.
export const Page: Story = {
  args: { variant: "page" },
};

export const Rail: Story = {
  args: { variant: "rail" },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
};
```

- [ ] **Step 7: `SendButton.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SendButton } from "./SendButton";

const meta = {
  title: "Newsletter/SendButton",
  component: SendButton,
} satisfies Meta<typeof SendButton>;

export default meta;
type Story = StoryObj<typeof meta>;

// Idle only. The component's other states are reached by clicking, which calls
// window.confirm and then POSTs to /api/newsletter/send — a browser modal would
// block the snapshot, and there are no play functions in this setup by design.
export const Idle: Story = {
  args: { slug: "issue-002" },
};
```

- [ ] **Step 8: Verify all 17 are indexed**

Run: `cd web && npm run build-storybook`, then:

```bash
cd web && node -e "const i=require('./storybook-static/index.json');const t=new Set(Object.values(i.entries).map(e=>e.title));console.log([...t].sort().join('\n'));console.log('components:',t.size,'stories:',Object.keys(i.entries).length)"
```

Expected: `components: 17 stories: 31`. Titles cover `Blog/` (2), `Newsletter/` (5), `Site/` (10); story exports are Site 16, Blog 4, Newsletter 11. If the component count is lower, a file is outside the `components/**/*.stories.tsx` glob or has no default export. 31 stories × 2 modes = **62 snapshots** per cold build — that is the number Task 6 checks against, not the spec §5 estimate of ~102.

- [ ] **Step 9: Run the full suite and commit**

```bash
cd web && npm test && npm run lint
cd /e/Personal/looper
git add web/components/blog/ web/components/newsletter/
git commit -m "test(web): add Storybook stories for blog and newsletter components

Seven components, taking the total to 17. SendButton is idle-only: its
other states are behind a window.confirm that would block a snapshot.

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 5: The Chromatic CI job

**Files:**
- Modify: `.github/workflows/deploy.yml` (add a `chromatic` job after `test`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `npm run build-storybook` from Task 1; the 17 story files from Tasks 3–4.
- Produces: a `chromatic` job. **It is not added to any other job's `needs:`** — in particular not `release`'s, whose `if:` is hand-rolled against `needs.test.result` and `needs.deploy.result`. A visual diff must never block a release.

- [ ] **Step 1: Add the job to `deploy.yml`**

Insert immediately after the `test` job's final step and before `promotion-guard`, at the same indentation as `test:`:

```yaml
  # Visual regression. Parallel to `test`, and deliberately absent from every
  # other job's `needs:` — a visual diff must not block a deploy or a release.
  chromatic:
    runs-on: ubuntu-latest
    # dev is the baseline branch. Promotion PRs (dev -> stage, stage -> main)
    # and stage/main pushes are skipped: their head SHA was already snapshotted
    # on dev, so re-running only spends snapshot budget.
    #
    # Dependabot is excluded because Actions secrets are not exposed to its
    # runs — CHROMATIC_PROJECT_TOKEN would be empty and the job would fail red
    # on every bump. A missing token is an error, not a "change", so
    # exitZeroOnChanges does not absorb it.
    if: >-
      github.actor != 'dependabot[bot]' && (
        (github.event_name == 'push' && github.ref_name == 'dev') ||
        (github.event_name == 'pull_request' && github.base_ref == 'dev')
      )
    steps:
      - uses: actions/checkout@v7
        with:
          # TurboSnap resolves which stories changed from git history and
          # silently falls back to a full build without it.
          fetch-depth: 0

      - name: Set up Node
        uses: actions/setup-node@v7
        with:
          node-version: "22"

      - name: Install app dependencies
        working-directory: web
        run: npm install

      - name: Publish to Chromatic
        uses: chromaui/action@v18
        with:
          projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
          workingDir: web
          # TurboSnap: snapshot only the stories the diff can reach.
          onlyChanged: true
          # Advisory gate. This is the action's default, set explicitly: the
          # diff is reviewed through Chromatic's own UI Tests PR check, and CI
          # stays green either way.
          exitZeroOnChanges: true
          # Return as soon as the build is uploaded rather than waiting for the
          # comparison — Chromatic reports the result on its own check.
          exitOnceUploaded: true
          # Required, not tidy: feature PRs are squash-merged into dev, and
          # GitHub squash creates a commit unassociated with the merged branch,
          # so baselines do not carry over on their own.
          autoAcceptChanges: dev
```

- [ ] **Step 2: Validate the workflow parses**

```bash
cd /e/Personal/looper && python -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/deploy.yml')); print(sorted(d['jobs'])); assert 'chromatic' in d['jobs']; assert 'chromatic' not in d['jobs']['release'].get('needs',[]), 'chromatic must not gate release'"
```

Expected: prints the job list including `chromatic`, no assertion error.

- [ ] **Step 3: Confirm `release` gating is untouched**

```bash
cd /e/Personal/looper && git diff .github/workflows/deploy.yml | grep -E "^[-+]\s*needs:" || echo "no changes to job dependencies"
```

Expected: `no changes to job dependencies`. The pattern anchors on a `needs:` *key*, not the word — the new job's own comment says "absent from every other job's `needs:`", and a looser grep matches that comment and fails for nothing. If a real `needs:` line appears in the diff, the job was inserted in the wrong place — revert and retry.

- [ ] **Step 4: Add the CHANGELOG entry**

Under `## [Unreleased]` in the repo-root `CHANGELOG.md`, in the `### Added` subsection. Today `[Unreleased]` holds only `### Fixed`, so create `### Added` *above* it — Keep a Changelog orders Added, Changed, Deprecated, Removed, Fixed, Security:

```markdown
- Storybook for `web/components/`, and Chromatic visual regression on pull requests into `dev`. Every story is snapshotted in both light and dark. Storybook is installed locally but never run by `npm test` or `npm run lint` — all build cost is on CI.
```

- [ ] **Step 5: Commit**

```bash
cd /e/Personal/looper
git add .github/workflows/deploy.yml CHANGELOG.md
git commit -m "ci: add Chromatic visual regression job

Parallel to test, scoped to PRs into dev and pushes to dev, advisory
only, TurboSnap on. Not in release's needs — its if: is hand-rolled and
a visual diff must not block a release. Dependabot is excluded because
Actions secrets are not exposed to its runs.

Closes #209

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>"
```

---

### Task 6: Wire up Chromatic and prove the whole thing works end to end

This task cannot be completed by an agent alone — steps 1 and 2 need the repository owner's Chromatic and GitHub accounts.

**Files:** none (verification only, plus a temporary scratch commit in step 6 that is reverted).

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: (Owner) Create the Chromatic project**

At <https://www.chromatic.com>, create a project and **link it to `DataCrusade1999/supreme-enigma`**. Linking is what makes Chromatic post its `UI Tests` and `Storybook Publish` PR checks — per Chromatic's docs, linked GitHub projects get that out of the box, with no separate GitHub App install.

This matters more than it looks: the CI job exits green by design, so those checks are the *only* PR-visible signal. An unlinked project means the job runs, uploads, and reports nothing.

- [ ] **Step 2: (Owner) Add the token**

```bash
gh secret set CHROMATIC_PROJECT_TOKEN --repo DataCrusade1999/supreme-enigma
```

Paste the project token when prompted.

- [ ] **Step 3: Open the PR**

```bash
cd /e/Personal/looper
git push
gh pr create --base dev --title "Add Storybook and Chromatic visual regression" --body "Closes #209

Storybook over the 17 components in \`web/components/\`, with Chromatic visual regression on PRs into \`dev\`. Every story snapshots in light and dark.

Design: \`docs/superpowers/specs/2026-09-18-storybook-chromatic-design.md\`

All build cost is on CI — neither storybook script is wired into \`npm test\` or \`npm run lint\`.

Requires the \`CHROMATIC_PROJECT_TOKEN\` secret and a Chromatic project linked to this repo."
```

- [ ] **Step 4: Verify the job ran and the baseline exists**

```bash
gh pr checks --watch --interval 20
```

Expected: `test` green, `chromatic` green. Then confirm the Chromatic build shows **two modes per story** (`light` and `dark`) and **62 snapshots** on this first, cold build (31 stories × 2). A count near 31 means the modes are not applying — check `parameters.chromatic.modes` in `preview.tsx`.

- [ ] **Step 5: Verify Chromatic's own checks appear**

```bash
gh api repos/DataCrusade1999/supreme-enigma/commits/$(git rev-parse HEAD)/status --jq '.statuses[].context'
```

Expected: includes `UI Tests` and `Storybook Publish`. **If they are absent, the project is not linked to the repo** (step 1) and the advisory gate is silently a no-op — fix that before merging.

- [ ] **Step 6: Prove a regression is actually caught**

Change one token on a scratch commit. `#146b64` is the **light** `@theme` value of `--color-accent`; the dark override in `:root.dark` is `#5ec8c0` and is left alone on purpose:

```bash
cd web
sed -i 's/--color-accent: #146b64;/--color-accent: #7a2f8f;/' app/globals.css
cd /e/Personal/looper
git commit -s -am "test: temporary token change to prove Chromatic catches it"
git push
```

Expected: Chromatic reports diffs in the **light** mode only, **none** in dark, and the `chromatic` job still reports **green**. All three matter: light-only diffs prove the light override is exercised and the two modes are independent (a broken light override is the regression this exists for — spec §3); a green job is the advisory gate working as designed. Diffs in both modes mean the dark snapshots are not getting `dark` on `<html>`. Then revert:

```bash
cd /e/Personal/looper
git revert -s --no-edit HEAD
git push
```

- [ ] **Step 7: Merge via the standing sequence**

Follow `CLAUDE.md`'s "Merging a PR" in full — it is not optional here:

1. `gh pr checks <N> --watch --interval 20` until `test` completes green.
2. `gh api repos/DataCrusade1999/supreme-enigma/commits/<sha>/status` → wait for `Release readiness review: change approved`. Anything else is a hard stop.
3. `gh api --paginate repos/DataCrusade1999/supreme-enigma/pulls/<N>/comments` — read inline findings from **both** bots (`aws-devops-agent` and `chatgpt-codex-connector[bot]`), triage by severity yourself, and act before merging.
4. Resolve the threads you addressed, with a reply saying what you did.
5. `gh pr merge <N> --squash --delete-branch`.
6. `git checkout dev && git pull --ff-only origin dev`.

- [ ] **Step 8: Record the manual prerequisites in memory**

Update `C:\Users\ashut\.claude\projects\E--Personal-looper\memory\project_pending_manual_actions.md` — mark the Chromatic project link and `CHROMATIC_PROJECT_TOKEN` as done once steps 1 and 2 are complete, so a later session does not re-ask.

---

## Notes for the executor

- **Known annual diff:** `SiteFooter` renders `new Date().getFullYear()`, so its snapshot changes once a year on 1 January. Accept the diff; do not mock the date.
- **If TurboSnap snapshots ~60 per PR instead of ~10,** the checkout depth is the first thing to check — TurboSnap degrades silently to a full build when it cannot resolve git history. The second is the base dir: Storybook lives in `web/`, not the git root, and TurboSnap maps changed git paths onto Storybook's module graph. Chromatic's docs say the base dir is auto-detected when the CLI runs from the same directory as `build-storybook`, which `workingDir: web` gives it, so `storybookBaseDir` is deliberately not set; if the build log shows a full rebuild with the history present, add `storybookBaseDir: web` to the action.
- **Do not add `@storybook/addon-vitest`.** Running stories as tests inside the existing Vitest run is a deliberate follow-up (spec §10), not part of this change — and it would put Storybook back into the local `npm test` loop, which is exactly what this design avoids.

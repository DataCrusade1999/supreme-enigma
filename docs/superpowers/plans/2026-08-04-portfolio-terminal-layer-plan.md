# Portfolio Terminal Layer (UI Overhaul Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a reusable terminal-chrome component (first used to reskin `/projects` as an `ls`-style listing) and a Cmd+K command-bar palette built on the same chrome, as a secondary nav path alongside the existing header nav.

**Architecture:** Two new presentational/interactive components (`TerminalWindow`, `CommandBar`) plus a static command-definition module (`lib/site/commands.ts`). `CommandBar` owns its own open/closed state and exposes a module-level `openCommandBar()` function (dispatching a `window` `CustomEvent`) as its public "open me" API, so `SiteHeader`'s trigger button and the global `Cmd+K` listener both call the same entry point without needing shared React state/context.

**Tech Stack:** Next.js 15 App Router (client components where interactive), TypeScript, Tailwind CSS v4, Vitest + Testing Library (existing test stack). No new dependencies.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-04-portfolio-terminal-layer-design.md`.
- Depends on Phase 1 (`docs/superpowers/plans/2026-08-04-portfolio-color-tokens-plan.md`) — `--color-accent` must already be teal before this phase's chrome is visually correct. Implement Phase 1 first.
- No real shell/command parsing — `CommandBar` is a filtered static list, not a REPL (per spec §5).
- Terminal chrome uses fixed colors regardless of site theme (its own `--color-terminal-bg`/`-fg` tokens, not swapped in `:root.dark`).
- Every interactive addition respects `prefers-reduced-motion: reduce`.
- `cd app && npm test` must pass after every task.

---

### Task 1: Terminal chrome tokens + fade keyframe

**Files:**
- Modify: `app/app/globals.css`

**Interfaces:**
- Produces: `--color-terminal-bg`, `--color-terminal-fg` (plain `:root` custom properties, fixed across both themes) and a `.commandbar-fade-in` utility class — consumed by Task 2 (`TerminalWindow`) and Task 4 (`CommandBar`).

- [x] **Step 1: Add the tokens and keyframe**

Add this block to `app/app/globals.css`, after the existing `:root.dark { … }` block and before the `html { … }` rule:

```css
/*
 * Terminal chrome is intentionally fixed-dark regardless of site theme —
 * that's what makes it read as a terminal rather than just a bordered box.
 * Not declared inside @theme/:root.dark, so the theme toggle doesn't touch it.
 */
:root {
  --color-terminal-bg: #0e1420;
  --color-terminal-fg: #d7deec;
}
```

Add this block after the existing `@media (prefers-reduced-motion: reduce) { .playhead { … } }` rule, at the end of the file:

```css
@keyframes commandbar-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.commandbar-fade-in {
  animation: commandbar-fade-in 120ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .commandbar-fade-in {
    animation: none;
  }
}
```

- [x] **Step 2: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS (no test references these tokens yet — this is a sanity check that the CSS is syntactically valid and nothing else broke).

- [x] **Step 3: Commit**

```bash
cd app && git add app/globals.css
git commit -m "$(cat <<'EOF'
style: add fixed terminal-chrome tokens and command-bar fade keyframe

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 2: `TerminalWindow` component

**Files:**
- Create: `app/components/site/TerminalWindow.tsx`
- Test: `app/components/site/TerminalWindow.test.tsx`

**Interfaces:**
- Consumes: `--color-terminal-bg`, `--color-terminal-fg` (Task 1).
- Produces: `TerminalWindow({ title, children }: { title: string; children: React.ReactNode })` — default export is NOT used (named export, matching this codebase's convention of named component exports, e.g. `SiteHeader`, `ThemeToggle`). Consumed by Task 4 (`CommandBar`) and Task 6 (`/projects` page).

- [x] **Step 1: Write the failing test**

```tsx
// app/components/site/TerminalWindow.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TerminalWindow } from "./TerminalWindow";

describe("TerminalWindow", () => {
  it("renders the title bar and the content", () => {
    render(
      <TerminalWindow title="projects — zsh">
        <p>hello from inside</p>
      </TerminalWindow>,
    );

    expect(screen.getByText("projects — zsh")).toBeInTheDocument();
    expect(screen.getByText("hello from inside")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run components/site/TerminalWindow.test.tsx`
Expected: FAIL — `Cannot find module './TerminalWindow'`.

- [x] **Step 3: Write the implementation**

```tsx
// app/components/site/TerminalWindow.tsx
type TerminalWindowProps = {
  title: string;
  children: React.ReactNode;
};

export function TerminalWindow({ title, children }: TerminalWindowProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex items-center gap-1.5 bg-[var(--color-terminal-bg)] px-3 py-2">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-2 font-mono text-[0.6875rem] text-[var(--color-terminal-fg)]/60">
          {title}
        </span>
      </div>
      <div className="bg-[var(--color-terminal-bg)] px-4 py-4 font-mono text-sm text-[var(--color-terminal-fg)]">
        {children}
      </div>
    </div>
  );
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run components/site/TerminalWindow.test.tsx`
Expected: PASS (1 test)

- [x] **Step 5: Commit**

```bash
cd app && git add components/site/TerminalWindow.tsx components/site/TerminalWindow.test.tsx
git commit -m "$(cat <<'EOF'
feat: add TerminalWindow chrome component

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 3: `lib/site/commands.ts`

**Files:**
- Create: `app/lib/site/commands.ts`
- Test: `app/lib/site/commands.test.ts`

**Interfaces:**
- Produces: `type CommandContext = { push: (href: string) => void }`, `type Command = { id: string; label: string; hint: string; run: (ctx: CommandContext) => void }`, `COMMANDS: Command[]` — consumed by Task 4 (`CommandBar`).

- [x] **Step 1: Write the failing tests**

```typescript
// app/lib/site/commands.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { COMMANDS } from "./commands";

describe("COMMANDS", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("has one command per nav destination, the tool, and both theme choices", () => {
    expect(COMMANDS.map((command) => command.id)).toEqual([
      "cd-home",
      "cd-about",
      "cd-projects",
      "cd-resume",
      "cd-blog",
      "cd-contact",
      "open-bgm-looper",
      "theme-dark",
      "theme-light",
    ]);
  });

  it("cd commands push their href", () => {
    const push = vi.fn();
    const projects = COMMANDS.find((command) => command.id === "cd-projects");
    projects?.run({ push });
    expect(push).toHaveBeenCalledWith("/projects");
  });

  it("open-bgm-looper pushes the tool route", () => {
    const push = vi.fn();
    const openLooper = COMMANDS.find((command) => command.id === "open-bgm-looper");
    openLooper?.run({ push });
    expect(push).toHaveBeenCalledWith("/tools/bgm-looper");
  });

  it("theme-dark sets the dark class and persists the choice", () => {
    const push = vi.fn();
    const themeDark = COMMANDS.find((command) => command.id === "theme-dark");
    themeDark?.run({ push });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("theme-light removes the dark class and persists the choice", () => {
    document.documentElement.classList.add("dark");
    const push = vi.fn();
    const themeLight = COMMANDS.find((command) => command.id === "theme-light");
    themeLight?.run({ push });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run lib/site/commands.test.ts`
Expected: FAIL — `Cannot find module './commands'`.

- [x] **Step 3: Write the implementation**

```typescript
// app/lib/site/commands.ts
export type CommandContext = {
  push: (href: string) => void;
};

export type Command = {
  id: string;
  label: string;
  hint: string;
  run: (ctx: CommandContext) => void;
};

function setTheme(theme: "dark" | "light") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("theme", theme);
}

export const COMMANDS: Command[] = [
  { id: "cd-home", label: "cd home", hint: "Go to the homepage", run: (ctx) => ctx.push("/") },
  { id: "cd-about", label: "cd about", hint: "About me", run: (ctx) => ctx.push("/about") },
  {
    id: "cd-projects",
    label: "cd projects",
    hint: "Browse projects",
    run: (ctx) => ctx.push("/projects"),
  },
  { id: "cd-resume", label: "cd resume", hint: "View resume", run: (ctx) => ctx.push("/resume") },
  { id: "cd-blog", label: "cd blog", hint: "Read the blog", run: (ctx) => ctx.push("/blog") },
  {
    id: "cd-contact",
    label: "cd contact",
    hint: "Get in touch",
    run: (ctx) => ctx.push("/contact"),
  },
  {
    id: "open-bgm-looper",
    label: "open bgm-looper",
    hint: "Launch the BGM Looper tool",
    run: (ctx) => ctx.push("/tools/bgm-looper"),
  },
  {
    id: "theme-dark",
    label: "theme dark",
    hint: "Switch to dark mode",
    run: () => setTheme("dark"),
  },
  {
    id: "theme-light",
    label: "theme light",
    hint: "Switch to light mode",
    run: () => setTheme("light"),
  },
];
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run lib/site/commands.test.ts`
Expected: PASS (5 tests)

- [x] **Step 5: Commit**

```bash
cd app && git add lib/site/commands.ts lib/site/commands.test.ts
git commit -m "$(cat <<'EOF'
feat: add command-bar command definitions

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 4: `CommandBar` component

**Files:**
- Create: `app/components/site/CommandBar.tsx`
- Test: `app/components/site/CommandBar.test.tsx`

**Interfaces:**
- Consumes: `TerminalWindow` (Task 2), `COMMANDS`/`Command`/`CommandContext` (Task 3), `useRouter` from `next/navigation`.
- Produces: `CommandBar()` (named export, default-rendered as `<CommandBar />`, no props) and `openCommandBar(): void` (named export — the public "open me" API used by Task 5's `SiteHeader` trigger). Consumed by Task 5 (`SiteHeader`, `(site)/layout.tsx`).

- [x] **Step 1: Write the failing tests**

```tsx
// app/components/site/CommandBar.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommandBar, openCommandBar } from "./CommandBar";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("CommandBar", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("is closed by default", () => {
    render(<CommandBar />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on Ctrl+K", () => {
    render(<CommandBar />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens when openCommandBar() is called externally", () => {
    render(<CommandBar />);
    act(() => openCommandBar());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("filters the command list as you type and navigates on Enter", () => {
    render(<CommandBar />);
    act(() => openCommandBar());

    const input = screen.getByLabelText("Command");
    fireEvent.change(input, { target: { value: "resume" } });

    expect(screen.getByText("cd resume")).toBeInTheDocument();
    expect(screen.queryByText("cd about")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/resume");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves selection with arrow keys before running on Enter", () => {
    render(<CommandBar />);
    act(() => openCommandBar());

    const input = screen.getByLabelText("Command");
    // First command is "cd home" (-> "/"); one ArrowDown selects "cd about".
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/about");
  });

  it("closes on Escape and returns focus to whatever was focused before opening", () => {
    render(
      <>
        <button>trigger</button>
        <CommandBar />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "trigger" });
    trigger.focus();

    act(() => openCommandBar());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Command"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("wraps Tab focus from the last element back to the input", () => {
    render(<CommandBar />);
    act(() => openCommandBar());

    const input = screen.getByLabelText("Command");
    expect(input).toHaveFocus();

    const buttons = screen.getAllByRole("button");
    const lastCommandButton = buttons[buttons.length - 1];
    lastCommandButton.focus();

    fireEvent.keyDown(lastCommandButton, { key: "Tab" });
    expect(input).toHaveFocus();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd app && npx vitest run components/site/CommandBar.test.tsx`
Expected: FAIL — `Cannot find module './CommandBar'`.

- [x] **Step 3: Write the implementation**

```tsx
// app/components/site/CommandBar.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TerminalWindow } from "./TerminalWindow";
import { COMMANDS, type Command, type CommandContext } from "../../lib/site/commands";

const OPEN_EVENT = "commandbar:open";

export function openCommandBar() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const router = useRouter();

  const filtered = COMMANDS.filter((command) =>
    command.label.toLowerCase().includes(query.toLowerCase()),
  );

  const open = useCallback(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setSelectedIndex(0);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const runCommand = useCallback(
    (command: Command) => {
      const ctx: CommandContext = { push: (href) => router.push(href) };
      command.run(ctx);
      close();
    },
    [router, close],
  );

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      const isModKey = event.metaKey || event.ctrlKey;
      if (isModKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener(OPEN_EVENT, open);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener(OPEN_EVENT, open);
    };
  }, [open]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  function handleDialogKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = filtered[selectedIndex];
      if (command) runCommand(command);
      return;
    }
    if (event.key === "Tab") {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'input, button, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="commandbar-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-24"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-md"
      >
        <TerminalWindow title="command-bar — zsh">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-[var(--color-accent)]">
              $
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIndex(0);
              }}
              placeholder="type a command…"
              aria-label="Command"
              className="flex-1 bg-transparent outline-none placeholder:text-[var(--color-terminal-fg)]/40"
            />
          </div>
          <ul className="mt-3 flex flex-col gap-0.5">
            {filtered.length === 0 && (
              <li className="text-[var(--color-terminal-fg)]/50">no matching command</li>
            )}
            {filtered.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  onClick={() => runCommand(command)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex w-full items-baseline justify-between gap-3 px-1 py-1 text-left ${
                    index === selectedIndex ? "text-[var(--color-accent)]" : ""
                  }`}
                >
                  <span>{command.label}</span>
                  <span className="text-[0.75rem] text-[var(--color-terminal-fg)]/50">
                    {command.hint}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </TerminalWindow>
      </div>
    </div>
  );
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd app && npx vitest run components/site/CommandBar.test.tsx`
Expected: PASS (7 tests)

- [x] **Step 5: Commit**

```bash
cd app && git add components/site/CommandBar.tsx components/site/CommandBar.test.tsx
git commit -m "$(cat <<'EOF'
feat: add Cmd+K command-bar palette

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 5: Wire the trigger into `SiteHeader` and mount `CommandBar`

**Files:**
- Modify: `app/components/site/SiteHeader.tsx:1-49`
- Modify: `app/components/site/SiteHeader.test.tsx`
- Modify: `app/app/(site)/layout.tsx:1-18`

**Interfaces:**
- Consumes: `openCommandBar` and `CommandBar` (Task 4).

- [x] **Step 1: Update the `SiteHeader` test first**

Replace the full contents of `app/components/site/SiteHeader.test.tsx` with:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SiteHeader } from "./SiteHeader";
import { openCommandBar } from "./CommandBar";

vi.mock("./CommandBar", () => ({
  openCommandBar: vi.fn(),
}));

describe("SiteHeader", () => {
  it("renders nav links and the BGM Looper CTA", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute("href", "/resume");
    expect(screen.getByRole("link", { name: "Blog" })).toHaveAttribute("href", "/blog");
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: "BGM Looper" })).toHaveAttribute(
      "href",
      "/tools/bgm-looper",
    );
  });

  it("opens the command bar when the trigger is clicked", () => {
    render(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Open command bar" }));
    expect(openCommandBar).toHaveBeenCalledOnce();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx`
Expected: FAIL — no button with accessible name "Open command bar" exists yet.

- [x] **Step 3: Add the trigger button to `SiteHeader`**

In `app/components/site/SiteHeader.tsx`, add the import and the button (kept always visible — the keyboard shortcut alone isn't reachable on mobile, so this doubles as the touch entry point):

```tsx
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { openCommandBar } from "./CommandBar";
```

Add this button inside the `<nav>`, immediately before `<ThemeToggle />`:

```tsx
          <button
            type="button"
            onClick={openCommandBar}
            aria-label="Open command bar"
            className="inline-flex items-center border border-line px-2 py-1.5 font-mono text-[0.6875rem] text-muted transition-colors hover:border-accent hover:text-fg"
          >
            ⌘K
          </button>
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run components/site/SiteHeader.test.tsx`
Expected: PASS (2 tests)

- [x] **Step 5: Mount `CommandBar` once in the site layout**

In `app/app/(site)/layout.tsx`, change:

```tsx
import { SiteHeader } from "../../components/site/SiteHeader";
import { SiteFooter } from "../../components/site/SiteFooter";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col font-sans">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8 sm:py-20">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
```

to:

```tsx
import { SiteHeader } from "../../components/site/SiteHeader";
import { SiteFooter } from "../../components/site/SiteFooter";
import { CommandBar } from "../../components/site/CommandBar";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col font-sans">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-14 sm:px-8 sm:py-20">
        {children}
      </main>
      <SiteFooter />
      <CommandBar />
    </div>
  );
}
```

- [x] **Step 6: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [x] **Step 7: Commit**

```bash
cd app && git add components/site/SiteHeader.tsx components/site/SiteHeader.test.tsx "app/(site)/layout.tsx"
git commit -m "$(cat <<'EOF'
feat: wire ⌘K trigger into header, mount command bar in site layout

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 6: Reskin `/projects` as a terminal `ls` listing

**Files:**
- Modify: `app/app/(site)/projects/page.tsx`
- Modify: `app/app/(site)/projects/page.test.tsx`

**Interfaces:**
- Consumes: `TerminalWindow` (Task 2), `projects` from `content/projects.ts` (unchanged).

Same data and same links as today (`project.href`, unchanged) — only the chrome and framing change, per spec §4.

- [x] **Step 1: Add a test for the new terminal framing**

Append this `it` block inside the existing `describe("ProjectsPage", …)` in `app/app/(site)/projects/page.test.tsx` (the existing `it` block asserting the BGM Looper link stays as-is — it should keep passing unmodified since the link's accessible name and href don't change):

```tsx
  it("renders inside the terminal window chrome", () => {
    render(<ProjectsPage />);
    expect(screen.getByText("projects — zsh")).toBeInTheDocument();
  });
```

- [x] **Step 2: Run the test to verify the new assertion fails**

Run: `cd app && npx vitest run "app/(site)/projects/page.test.tsx"`
Expected: FAIL on the new test — "projects — zsh" doesn't exist yet. The original test still passes.

- [x] **Step 3: Rewrite the page**

Replace the full contents of `app/app/(site)/projects/page.tsx` with:

```tsx
import Link from "next/link";
import { projects } from "../../../content/projects";
import { TerminalWindow } from "../../../components/site/TerminalWindow";

export default function ProjectsPage() {
  return (
    <section>
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
        Index
      </p>
      <h1 className="mt-4 font-mono text-3xl font-semibold tracking-tight">
        Projects
      </h1>

      <div className="mt-10">
        <TerminalWindow title="projects — zsh">
          <p className="text-[var(--color-accent)]">$ ls</p>
          <ul className="mt-3 flex flex-col gap-5">
            {projects.map((project) => (
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
            ))}
          </ul>
        </TerminalWindow>
      </div>
    </section>
  );
}
```

- [x] **Step 4: Run the test to verify both assertions pass**

Run: `cd app && npx vitest run "app/(site)/projects/page.test.tsx"`
Expected: PASS (2 tests) — the original link-href assertion and the new terminal-chrome assertion.

- [x] **Step 5: Run the full test suite**

Run: `cd app && npm test`
Expected: PASS

- [x] **Step 6: Commit**

```bash
cd app && git add "app/(site)/projects/page.tsx" "app/(site)/projects/page.test.tsx"
git commit -m "$(cat <<'EOF'
feat: reskin /projects as a terminal ls listing

Signed-off-by: Ashutosh Pandey <ashutosh.pandeyhlr007@gmail.com>
EOF
)"
```

---

### Task 7: Manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [x] **Step 1: Start the dev server**

Run: `cd app && APP_PASSWORD=test123 COOKIE_SECRET=devsecret npm run dev`

- [x] **Step 2: Keyboard-only run-through**

Without touching the mouse: `Tab` to the `⌘K` button in the header, press `Enter` to open the command bar, confirm the input is focused immediately. Type `"proj"`, confirm the list filters to `cd projects`. Press `Enter`, confirm the browser navigates to `/projects` and the dialog closes. Repeat, this time pressing `Escape` instead of `Enter`, and confirm focus returns to the `⌘K` button (a visible focus ring should reappear on it).

- [x] **Step 3: Global shortcut and mouse/touch trigger**

From any page, press `Ctrl+K` (or `Cmd+K` on macOS) — confirm the command bar opens regardless of which element had focus. Close it, then click the `⌘K` button with the mouse — confirm it opens the same way.

- [x] **Step 4: Both themes**

Toggle light/dark via the theme button. Confirm the `/projects` terminal window and the command-bar dialog both stay visually dark (fixed terminal chrome) in *both* site themes — this is intentional per spec §3, not a bug.

- [x] **Step 5: Reduced motion**

Enable "reduce motion" in the OS accessibility settings (or emulate it via Chrome DevTools' Rendering tab → "Emulate CSS media feature prefers-reduced-motion: reduce"). Open the command bar and confirm it appears instantly with no fade transition.

- [x] **Step 6: Stop the dev server**

Ctrl+C in the terminal running `npm run dev`.

No commit for this task — verification only. If any step surfaces a problem, fix it in the relevant task's files, re-run that task's tests, then repeat this task's steps.

---

## Self-Review Notes

- **Spec coverage:** §3 (tokens) → Task 1. §4 (`TerminalWindow`) → Task 2, applied in Task 6. §5 (`CommandBar` trigger/behavior/command set) → Tasks 3-5. §6 (testing) → covered across Tasks 2-6's automated tests plus Task 7's manual pass. §7 (out of scope: no real parser, no other chrome targets) → confirmed, `CommandBar` only ever runs a fixed `COMMANDS` list, no other page besides `/projects` is touched.
- **Type consistency:** `CommandContext`/`Command` defined once in Task 3, imported by exact name into Task 4 — no drift. `TerminalWindow`'s `{ title, children }` props match every call site (Task 4's dialog, Task 6's page).
- **No placeholders:** every component above is complete, runnable code — no "add styling here" or "handle other cases" gaps.

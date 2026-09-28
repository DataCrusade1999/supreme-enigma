// web/components/site/CommandBar.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TerminalWindow } from "./TerminalWindow";
import { COMMANDS, type Command, type CommandContext } from "../../lib/site/commands";

const OPEN_EVENT = "commandbar:open";

// Accepts an explicit trigger element because Safari (unlike Chrome/Firefox)
// doesn't move focus to a <button> on mouse click — relying solely on
// document.activeElement in open() below would silently fail to restore
// focus after a Safari mouse click. Callers that already know their own
// element (e.g. CommandBarTrigger's onClick) should pass it explicitly;
// the global Ctrl+K listener omits it and falls back to activeElement,
// which is reliable for real keyboard focus.
export function openCommandBar(trigger?: HTMLElement) {
  window.dispatchEvent(new CustomEvent<HTMLElement | undefined>(OPEN_EVENT, { detail: trigger }));
}

export function CommandBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const isOpenRef = useRef(false);
  const overlayMouseDownOnSelfRef = useRef(false);
  const router = useRouter();

  // An empty query shows only the pinned commands; typing searches them all.
  const filtered = query
    ? COMMANDS.filter((command) => command.label.toLowerCase().includes(query.toLowerCase()))
    : COMMANDS.filter((command) => command.pinned);
  const hiddenCount = query ? 0 : COMMANDS.length - filtered.length;

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const open = useCallback((explicitTrigger?: HTMLElement) => {
    // Guard against a repeat Ctrl+K while the dialog is already open, which
    // would otherwise reset `query` and reassign `triggerRef` to the dialog's
    // own input, corrupting focus-restore on close. Read via a ref rather
    // than adding `isOpen` to this callback's deps, so identity stays stable
    // for the keydown-listener effect below.
    if (isOpenRef.current) return;
    triggerRef.current =
      explicitTrigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setQuery("");
    setSelectedIndex(0);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // A command like `open bgm-looper` navigates away before this runs,
    // which can unmount the trigger (SiteHeader isn't rendered on /tools/*).
    // Calling focus() on a detached element is a silent no-op, so guard it
    // rather than leave focus to fall through to <body> unexpectedly.
    if (triggerRef.current?.isConnected) {
      triggerRef.current.focus();
    }
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
      if (!isModKey || event.key.toLowerCase() !== "k") return;
      // Don't hijack Ctrl/Cmd+K while the user is typing in a real form
      // field — e.g. the /contact form — and don't swallow Firefox's own
      // Ctrl+K search-bar shortcut for that case either. closest(), not
      // matches(), so a descendant of a contentEditable region (event.target
      // would be the inner node, not the editable root) is still caught.
      //
      // Password fields are the one exception: Ctrl+K means nothing while
      // typing a password, and /login's box is both the first thing a visitor
      // clicks and the page's only nav besides the wordmark, so guarding it
      // would make the shortcut look broken exactly where it matters most.
      const target = event.target;
      const field =
        target instanceof HTMLElement
          ? target.closest('input, textarea, select, [contenteditable="true"]')
          : null;
      if (field && !(field instanceof HTMLInputElement && field.type === "password")) {
        return;
      }
      event.preventDefault();
      open();
    }
    function handleOpenEvent(event: Event) {
      const trigger = event instanceof CustomEvent ? (event.detail as HTMLElement | undefined) : undefined;
      open(trigger);
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener(OPEN_EVENT, handleOpenEvent);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener(OPEN_EVENT, handleOpenEvent);
    };
  }, [open]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Lock body scroll while the modal is open so wheel/touch/PageDown input
  // doesn't scroll the page behind it.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
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
      onMouseDown={(event) => {
        // A drag-select that starts inside the dialog (e.g. selecting the
        // input's text) and releases over the backdrop fires `click` on
        // this shared ancestor — track whether the press itself started on
        // the overlay so that case doesn't close the dialog mid-selection.
        overlayMouseDownOnSelfRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && overlayMouseDownOnSelfRef.current) {
          close();
        }
      }}
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
            <span aria-hidden="true" className="text-[var(--color-terminal-accent)]">
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
                  // Deliberately onMouseMove, not onMouseEnter: a filtered
                  // row can slide under a stationary cursor when the list
                  // reflows (e.g. the user deletes a character), and that
                  // fires mouseenter with zero actual pointer movement,
                  // silently overriding the selection the keyboard just
                  // set. mousemove only fires on genuine cursor movement.
                  onMouseMove={() => setSelectedIndex(index)}
                  className={`flex w-full items-baseline justify-between gap-3 px-1 py-1 text-left ${
                    index === selectedIndex ? "text-[var(--color-terminal-accent)]" : ""
                  }`}
                >
                  <span className="shrink-0 whitespace-nowrap">{command.label}</span>
                  <span className="min-w-0 truncate text-[0.75rem] text-[var(--color-terminal-fg)]/50">
                    {command.hint}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && (
            <p className="mt-3 border-t border-[var(--color-terminal-fg)]/10 px-1 pt-2 text-[0.75rem] text-[var(--color-terminal-fg)]/50">
              {hiddenCount} more — type to search
            </p>
          )}
        </TerminalWindow>
      </div>
    </div>
  );
}

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
  const isOpenRef = useRef(false);
  const router = useRouter();

  const filtered = COMMANDS.filter((command) =>
    command.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const open = useCallback(() => {
    // Guard against a repeat Ctrl+K while the dialog is already open, which
    // would otherwise reset `query` and reassign `triggerRef` to the dialog's
    // own input, corrupting focus-restore on close. Read via a ref rather
    // than adding `isOpen` to this callback's deps, so identity stays stable
    // for the keydown-listener effect below.
    if (isOpenRef.current) return;
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
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex w-full items-baseline justify-between gap-3 px-1 py-1 text-left ${
                    index === selectedIndex ? "text-[var(--color-terminal-accent)]" : ""
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

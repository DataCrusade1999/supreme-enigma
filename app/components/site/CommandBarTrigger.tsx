"use client";

import { useSyncExternalStore } from "react";
import { openCommandBar } from "./CommandBar";

type NavigatorWithUAData = Navigator & {
  userAgentData?: { platform?: string };
};

function detectIsMac(): boolean {
  const nav = navigator as NavigatorWithUAData;
  // `||`, not `??`: jsdom (and some real browsers) report `platform` as `""`,
  // which `??` would treat as present and never fall through to userAgent.
  const platform = nav.userAgentData?.platform || nav.userAgent || nav.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// Platform never changes after mount, so there's no real store to subscribe
// to — this only exists to give useSyncExternalStore an SSR-safe way to read
// navigator once on the client without the cascading-render setState-in-effect
// pattern. Calling onStoreChange once here (subscribe runs post-commit)
// triggers the one re-check that swaps the SSR fallback for the real value.
function subscribe(onStoreChange: () => void) {
  onStoreChange();
  return () => {};
}

function getSnapshot() {
  return detectIsMac() ? "⌘K" : "Ctrl K";
}

function getServerSnapshot() {
  return "⌘K";
}

export function CommandBarTrigger() {
  const label = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <button
      type="button"
      onClick={openCommandBar}
      aria-label="Open command bar"
      className="inline-flex items-center border border-line px-2 py-1.5 font-mono text-[0.6875rem] text-muted transition-colors hover:border-accent hover:text-fg"
    >
      {label}
    </button>
  );
}

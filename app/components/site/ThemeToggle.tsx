"use client";

import { useEffect, useState } from "react";
import { setTheme, THEME_CHANGE_EVENT } from "../../lib/site/theme";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    // One-time correction to match the class the pre-hydration inline script already
    // set on <html>; can't read `document` during render since this also runs on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  useEffect(() => {
    // Keep this button's state in sync when the theme is changed from
    // outside (e.g. the command bar's `theme dark`/`theme light` commands),
    // not just from this button's own click.
    function handleThemeChange() {
      setIsDark(document.documentElement.classList.contains("dark"));
    }
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  }, []);

  function toggle() {
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Names the state the click will produce, not the current one — spec §9.
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center border border-line text-muted transition-colors duration-200 ease-out hover:border-accent hover:text-fg motion-reduce:transition-none"
    >
      {/* Both icons are always mounted and stacked; the inactive one is rotated
       * out and faded, so the swap is one crossfade rather than a remount. */}
      <Icon visible={isDark}>
        <circle cx="8" cy="8" r="3.25" />
        <path d="M8 1v1.75M8 13.25V15M1 8h1.75M13.25 8H15M3.05 3.05l1.24 1.24M11.71 11.71l1.24 1.24M12.95 3.05l-1.24 1.24M4.29 11.71l-1.24 1.24" />
      </Icon>
      <Icon visible={!isDark}>
        <path d="M13.25 9.6A5.75 5.75 0 0 1 6.4 2.75 5.75 5.75 0 1 0 13.25 9.6Z" />
      </Icon>
    </button>
  );
}

function Icon({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      // `rotate`, not `transform`: Tailwind v4 compiles `rotate-0`/`-rotate-90`
      // to the standalone `rotate` property, so naming `transform` here would
      // crossfade the opacity while the turn snapped.
      className={`absolute h-4 w-4 transition-[opacity,rotate] duration-[160ms] ease-out motion-reduce:transition-none ${
        visible ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"
      }`}
    >
      {children}
    </svg>
  );
}

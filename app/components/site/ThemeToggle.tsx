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
      className="border border-line px-2.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-muted transition-colors hover:border-accent hover:text-fg"
    >
      {isDark ? "Light mode" : "Dark mode"}
    </button>
  );
}

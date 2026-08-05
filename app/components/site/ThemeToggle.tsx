"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    // One-time correction to match the class the pre-hydration inline script already
    // set on <html>; can't read `document` during render since this also runs on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
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

// web/lib/site/theme.ts
// Single place that writes the theme to the DOM + localStorage, so every
// caller (the command bar's `theme dark`/`theme light` commands, the
// ThemeToggle button) stays in sync. Callers that hold their own React state
// mirroring the DOM (ThemeToggle) should subscribe to THEME_CHANGE_EVENT
// rather than writing the DOM directly.
export const THEME_CHANGE_EVENT = "theme:change";

export function setTheme(theme: "dark" | "light") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("theme", theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

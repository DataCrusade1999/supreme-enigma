// Inline in <head> so the theme is set before first paint. lib/csp.ts allows it
// on the /tools pages by hash, so any change to this text changes the hash with it.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "light" || stored === "dark" ? stored : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
  } catch (e) {}
})();
`;

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
  // Named rather than returned anonymously: eslint-config-next's
  // react/display-name infers a component's name from the binding, and an
  // inline `return (Story) => …` has none.
  const WithHtmlClasses: Decorator = (Story) => (
    <HtmlClasses classes={classes}>
      <Story />
    </HtmlClasses>
  );
  return WithHtmlClasses;
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

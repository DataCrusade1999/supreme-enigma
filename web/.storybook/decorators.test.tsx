import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { THEME_CHANGE_EVENT } from "../lib/site/theme";
import { HtmlClasses, SiteTheme, makeHtmlClassDecorator, withSiteTheme } from "./decorators";

// Stand-ins for the hashed class names next/font generates (e.g.
// "__variable_1e4310"). The real values come from preview.tsx; this module
// must never import next/font itself — it is a build-time SWC transform and
// throws under Vitest.
const FONT_CLASSES = ["__variable_display", "__variable_ui"];

describe("HtmlClasses", () => {
  it("puts the classes on documentElement, not on a wrapper element", () => {
    const { container } = render(
      <HtmlClasses classes={FONT_CLASSES}>
        <p>story</p>
      </HtmlClasses>,
    );

    // The target is load-bearing: @theme declares
    // --font-display: var(--font-instrument-serif), serif on :root, and a
    // custom property resolves its inner var() on the declaring element. Put
    // these classes on a wrapper and --font-display has already collapsed to
    // `serif` on :root — every snapshot silently renders the fallback.
    for (const className of FONT_CLASSES) {
      expect(document.documentElement.classList.contains(className)).toBe(true);
      expect(container.querySelector(`.${className}`)).toBeNull();
    }
  });

  it("removes the classes when the story unmounts", () => {
    const { unmount } = render(
      <HtmlClasses classes={FONT_CLASSES}>
        <p>story</p>
      </HtmlClasses>,
    );

    unmount();

    for (const className of FONT_CLASSES) {
      expect(document.documentElement.classList.contains(className)).toBe(false);
    }
  });

  it("leaves classes it did not add alone", () => {
    document.documentElement.classList.add("dark");

    const { unmount } = render(
      <HtmlClasses classes={FONT_CLASSES}>
        <p>story</p>
      </HtmlClasses>,
    );
    unmount();

    // SiteTheme owns `dark`. Stripping it on unmount would make
    // every story after the first render in light mode.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    document.documentElement.classList.remove("dark");
  });
});

describe("makeHtmlClassDecorator", () => {
  it("wraps a story so the classes reach documentElement", () => {
    const decorator = makeHtmlClassDecorator(FONT_CLASSES);
    function Wrapped() {
      return <>{decorator(() => <p>story</p>, {} as never)}</>;
    }

    render(<Wrapped />);

    expect(document.documentElement.classList.contains("__variable_display")).toBe(true);
  });
});

describe("SiteTheme", () => {
  it("puts dark on documentElement and fires the theme event after children mount", () => {
    // ThemeToggle reads the class in its own mount effect and re-reads on this
    // event. A parent's effect runs after a child's, so the event is what
    // makes the toggle's icon match the page in a fresh dark-mode load.
    const onChange = vi.fn();
    window.addEventListener(THEME_CHANGE_EVENT, onChange);

    render(
      <SiteTheme theme="dark">
        <p>story</p>
      </SiteTheme>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  });

  it("removes dark for the light theme", () => {
    document.documentElement.classList.add("dark");

    render(
      <SiteTheme theme="light">
        <p>story</p>
      </SiteTheme>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("withSiteTheme", () => {
  it("reads the theme global, defaulting to dark", () => {
    document.documentElement.classList.remove("dark");
    function Wrapped() {
      return <>{withSiteTheme(() => <p>story</p>, { globals: {} } as never)}</>;
    }

    render(<Wrapped />);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    document.documentElement.classList.remove("dark");
  });
});

import type { Preview } from "@storybook/nextjs-vite";
import { IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import { makeHtmlClassDecorator, withSiteTheme } from "./decorators";
import "../app/globals.css";

// Same two faces, same weights and fallbacks as app/layout.tsx. Declared here
// too because a story never renders the root layout, and globals.css points
// --font-display/--font-ui at the variables these write.
const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const ibmPlexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
  fallback: [
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
});

const preview: Preview = {
  // The toolbar switcher. Chromatic's modes below set this same global, so one
  // story export is captured once per theme.
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: {
        title: "Theme",
        icon: "contrast",
        items: ["light", "dark"],
        dynamicTitle: true,
      },
    },
  },
  // The site default, per app/layout.tsx.
  initialGlobals: { theme: "dark" },
  parameters: {
    // Mounts the App Router context. The framework mocks both Next routers but
    // defaults to the pages router, and CommandBar's useRouter from
    // next/navigation throws "invariant expected app router to be mounted"
    // without this — the story renders nothing and snapshots a blank frame.
    // Global rather than per-story: every component here is rendered from app/.
    nextjs: { appDirectory: true },
    // globals.css sets html { background-color: var(--color-bg) }, so the
    // canvas already tracks the theme. Storybook's own backgrounds addon would
    // paint over it.
    backgrounds: { disable: true },
    // Two snapshots per story from one export. Chromatic's docs factor these
    // into a separate .storybook/modes.ts; inlined here because there are two
    // modes and one consumer.
    chromatic: {
      modes: {
        light: { theme: "light" },
        dark: { theme: "dark" },
      },
    },
  },
  decorators: [
    // Font variables on <html> — see decorators.tsx for why the target matters.
    makeHtmlClassDecorator([instrumentSerif.variable, ibmPlexSans.variable]),
    // `dark` on <html> via lib/site/theme.ts's setTheme — see decorators.tsx
    // for why this is not @storybook/addon-themes.
    withSiteTheme,
    // Presentation padding and the base text colour. Safe on a wrapper — only
    // the custom-property *declarations* above have to be on :root.
    (Story) => (
      <div className="bg-bg p-8 font-ui text-fg">
        <Story />
      </div>
    ),
  ],
};

export default preview;

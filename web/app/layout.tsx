import type { Metadata } from "next";
import { IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

// Self-hosted at build time by next/font, so there is no render-blocking
// request to fonts.googleapis.com and no <link> anywhere. The fallbacks are
// metric-adjacent on purpose; --font-display/--font-ui in globals.css point at
// the two variables these write onto <html>.
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

export const metadata: Metadata = {
  title: "Ashutosh Pandey",
  description: "Portfolio — projects, resume, and the BGM Looper tool.",
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var theme = stored === "light" || stored === "dark" ? stored : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${instrumentSerif.variable} ${ibmPlexSans.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-ui text-fg">
        {children}
        {/* In the root layout rather than the (site) group, so the gated /tools
          * routes are counted too. Analytics is cookie-free — a visitor is a
          * per-day hash of the request — so neither needs a consent banner.
          *
          * Both pick their script from NODE_ENV, not VERCEL_ENV, so they are
          * not inert off Vercel: `npm run dev` and Vitest load the debug script
          * from va.vercel-scripts.com, and a local production build requests
          * /_vercel/insights/script.js, which only Vercel serves and which 404s
          * harmlessly under Playwright. Either way no data leaves a local run,
          * and no test asserts on console or network errors. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

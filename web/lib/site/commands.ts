import { setTheme } from "./theme";

export type CommandContext = {
  push: (href: string) => void;
};

export type Command = {
  id: string;
  label: string;
  hint: string;
  // Shown with an empty query. Everything else only appears once typed for.
  pinned?: boolean;
  run: (ctx: CommandContext) => void;
};

export const COMMANDS: Command[] = [
  { id: "cd-home", label: "cd home", hint: "Go to the homepage", run: (ctx) => ctx.push("/") },
  { id: "cd-about", label: "cd about", hint: "About me", run: (ctx) => ctx.push("/about") },
  {
    id: "cd-projects",
    label: "cd projects",
    hint: "Browse projects",
    pinned: true,
    run: (ctx) => ctx.push("/projects"),
  },
  {
    id: "cd-resume",
    label: "cd resume",
    hint: "View resume",
    pinned: true,
    run: (ctx) => ctx.push("/resume"),
  },
  { id: "cd-blog", label: "cd blog", hint: "Read the blog", pinned: true, run: (ctx) => ctx.push("/blog") },
  {
    id: "cd-newsletter",
    label: "cd newsletter",
    hint: "Read the newsletter archive",
    run: (ctx) => ctx.push("/newsletter"),
  },
  {
    id: "cd-contact",
    label: "cd contact",
    hint: "Get in touch",
    pinned: true,
    run: (ctx) => ctx.push("/contact"),
  },
  {
    id: "cd-tools",
    label: "cd tools",
    hint: "Every tool behind the gate",
    pinned: true,
    run: (ctx) => ctx.push("/tools"),
  },
  {
    id: "open-bgm-looper",
    label: "open bgm-looper",
    hint: "Launch the BGM Looper tool",
    run: (ctx) => ctx.push("/tools/bgm-looper"),
  },
  // The gated tools with no link on the public site. Spelled out here rather
  // than generated from TOOLS: the label is the command a person types, which
  // isn't derivable from a route (`/keystatic` → `open content-editor`).
  {
    id: "open-resume-admin",
    label: "open resume-admin",
    hint: "Publish a resume",
    run: (ctx) => ctx.push("/tools/resume-admin"),
  },
  {
    id: "open-newsletter-admin",
    label: "open newsletter-admin",
    hint: "Send a newsletter issue",
    run: (ctx) => ctx.push("/tools/newsletter-admin"),
  },
  {
    id: "open-money-planner",
    label: "open money-planner",
    hint: "Work out when you can afford something",
    run: (ctx) => ctx.push("/tools/money-planner"),
  },
  {
    id: "open-news-desk",
    label: "open news-desk",
    hint: "Read economy, reform and legislation headlines",
    run: (ctx) => ctx.push("/tools/news-desk"),
  },
  {
    id: "open-content-editor",
    label: "open content-editor",
    hint: "Write a blog post",
    run: (ctx) => ctx.push("/keystatic"),
  },
  {
    id: "theme",
    label: "theme",
    hint: "Switch light / dark",
    pinned: true,
    run: () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
  },
];

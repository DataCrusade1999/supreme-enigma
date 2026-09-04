import { setTheme } from "./theme";

export type CommandContext = {
  push: (href: string) => void;
};

export type Command = {
  id: string;
  label: string;
  hint: string;
  run: (ctx: CommandContext) => void;
};

export const COMMANDS: Command[] = [
  { id: "cd-home", label: "cd home", hint: "Go to the homepage", run: (ctx) => ctx.push("/") },
  { id: "cd-about", label: "cd about", hint: "About me", run: (ctx) => ctx.push("/about") },
  {
    id: "cd-projects",
    label: "cd projects",
    hint: "Browse projects",
    run: (ctx) => ctx.push("/projects"),
  },
  { id: "cd-resume", label: "cd resume", hint: "View resume", run: (ctx) => ctx.push("/resume") },
  { id: "cd-blog", label: "cd blog", hint: "Read the blog", run: (ctx) => ctx.push("/blog") },
  {
    id: "cd-contact",
    label: "cd contact",
    hint: "Get in touch",
    run: (ctx) => ctx.push("/contact"),
  },
  {
    id: "open-bgm-looper",
    label: "open bgm-looper",
    hint: "Launch the BGM Looper tool",
    run: (ctx) => ctx.push("/tools/bgm-looper"),
  },
  {
    id: "theme-dark",
    label: "theme dark",
    hint: "Switch to dark mode",
    run: () => setTheme("dark"),
  },
  {
    id: "theme-light",
    label: "theme light",
    hint: "Switch to light mode",
    run: () => setTheme("light"),
  },
];

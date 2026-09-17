import type { Resume } from "../lib/resume-schema";

// The fallback shown until a resume is published. Deliberately obvious
// placeholder copy: a visitor seeing this should be able to tell nothing real
// has been published yet, rather than believing these are actual roles.
export const placeholderResume: Resume = {
  headline: {
    name: "Ashutosh Pandey",
    title: "[Your title]",
    summary:
      "[One sentence on what you build and why it is worth building.]",
  },
  work: [
    {
      role: "Add your most recent role here",
      org: "Add your employer here",
      start: "20XX",
      end: "Present",
      bullets: [
        "Replace with a real accomplishment, focused on impact and scale.",
        "Add 2-4 bullets per role.",
      ],
    },
  ],
  skills: [
    { group: "Languages", items: ["[Add your languages]"] },
    { group: "Tools", items: ["[Add your tools]"] },
  ],
};

export type ResumeEntry = {
  role: string;
  org: string;
  start: string;
  end: string;
  bullets: string[];
};

export const resume: ResumeEntry[] = [
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
];

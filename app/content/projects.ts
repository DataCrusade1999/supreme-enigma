export type Project = {
  slug: string;
  name: string;
  description: string;
  href: string;
};

export const projects: Project[] = [
  {
    slug: "bgm-looper",
    name: "BGM Looper",
    description:
      "Upload a background-music track and get back a seamlessly looping, loudness-normalized version — beat-aligned loop point, equal-power crossfade, computed by a Python DSP pipeline on AWS Lambda.",
    href: "/tools/bgm-looper",
  },
];

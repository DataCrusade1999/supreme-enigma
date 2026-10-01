import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BlogList, type BlogListPost } from "./BlogList";

const meta = {
  title: "Blog/BlogList",
  component: BlogList,
} satisfies Meta<typeof BlogList>;

export default meta;
type Story = StoryObj<typeof meta>;

const posts: BlogListPost[] = [
  {
    slug: "seamless-loops",
    title: "Finding a seamless loop point",
    date: "2026-08-14",
    summary:
      "Beat-aligned cut points, equal-power crossfades, and why the naive approach clicks.",
    tags: ["dsp", "python"],
  },
  {
    slug: "lambda-containers",
    title: "Shipping ffmpeg in a Lambda container image",
    date: "2026-07-02",
    summary: "A static build, a 250MB budget, and one very slow cold start.",
    tags: ["aws", "lambda"],
  },
];

export const Default: Story = {
  args: { posts },
};

// The row is a 12-column grid with the title spanning 7. A long title is where
// the wrap and the hover-rule alignment break first.
export const LongTitle: Story = {
  args: {
    posts: [
      {
        ...posts[0],
        title:
          "Why the loop point has to land on a beat boundary and not merely a zero crossing",
      },
    ],
  },
};

// The page renders the list unconditionally, so the empty case is reachable.
export const Empty: Story = {
  args: { posts: [] },
};

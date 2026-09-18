import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PostBody } from "./PostBody";

const meta = {
  title: "Blog/PostBody",
  component: PostBody,
} satisfies Meta<typeof PostBody>;

export default meta;
type Story = StoryObj<typeof meta>;

// PostBody takes already-rendered children — Markdoc runs upstream — so a
// couple of paragraphs are a faithful stand-in, not a simplification.
export const Default: Story = {
  args: {
    title: "Finding a seamless loop point",
    date: "2026-08-14",
    children: (
      <>
        <p>
          A loop is seamless when the tail already sounds like the head. That is
          a statement about phase as much as amplitude.
        </p>
        <p>
          The naive approach cuts at a zero crossing and crossfades linearly,
          which drops 3dB through the overlap and reads as a dip.
        </p>
      </>
    ),
  },
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageMasthead } from "./PageMasthead";

const meta = {
  title: "Site/PageMasthead",
  component: PageMasthead,
} satisfies Meta<typeof PageMasthead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { eyebrow: "Writing", title: "Blog" },
};

export const WithRightSlot: Story = {
  args: {
    eyebrow: "Career",
    title: "Resume",
    right: (
      <a className="text-[0.6875rem] uppercase tracking-[0.16em] text-accent" href="#">
        Download PDF
      </a>
    ),
  },
};

// The title is the largest type on the site (5.25rem at sm). Worth its own
// snapshot: the wrap is where a font or leading regression shows first.
export const LongTitle: Story = {
  args: { eyebrow: "Tools", title: "Background Music Looper" },
};

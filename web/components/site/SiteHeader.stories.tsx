import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SiteHeader } from "./SiteHeader";

const meta = {
  title: "Site/SiteHeader",
  component: SiteHeader,
} satisfies Meta<typeof SiteHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

// Takes no props. The nav list and the ThemeToggle are both internal, so one
// story covers it — the value is the diff, not the variants.
export const Default: Story = {};

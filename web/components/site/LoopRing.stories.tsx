import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LoopRing } from "./LoopRing";

const meta = {
  title: "Site/LoopRing",
  component: LoopRing,
} satisfies Meta<typeof LoopRing>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoSeam: Story = {
  args: { seam: false },
};

export const Small: Story = {
  args: { radius: 56, scale: 0.3 },
};

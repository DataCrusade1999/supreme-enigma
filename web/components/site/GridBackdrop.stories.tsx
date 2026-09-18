import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GridBackdrop } from "./GridBackdrop";

const meta = {
  title: "Site/GridBackdrop",
  component: GridBackdrop,
  decorators: [
    // The component is `absolute inset-0 -z-10`, so on its own it collapses to
    // nothing and snapshots as an empty frame. It needs a positioned ancestor
    // with real height, which on the site is the page shell.
    (Story) => (
      <div className="relative h-80 w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GridBackdrop>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

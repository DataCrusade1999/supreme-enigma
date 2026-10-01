import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SendButton } from "./SendButton";

const meta = {
  title: "Newsletter/SendButton",
  component: SendButton,
} satisfies Meta<typeof SendButton>;

export default meta;
type Story = StoryObj<typeof meta>;

// Idle only. The component's other states are reached by clicking, which calls
// window.confirm and then POSTs to /api/newsletter/send — a browser modal would
// block the snapshot, and there are no play functions in this setup by design.
export const Idle: Story = {
  args: { slug: "issue-002" },
};

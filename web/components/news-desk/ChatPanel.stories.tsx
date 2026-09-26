import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChatPanel } from "./ChatPanel";

const meta = {
  title: "News Desk/ChatPanel",
  component: ChatPanel,
} satisfies Meta<typeof ChatPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

// Closed until the "Ask MoSPI" button is clicked; asking needs the API route.
export const Default: Story = {
  args: { onPinned: () => {} },
};

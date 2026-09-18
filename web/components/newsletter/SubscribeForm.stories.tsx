import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SubscribeForm } from "./SubscribeForm";

const meta = {
  title: "Newsletter/SubscribeForm",
  component: SubscribeForm,
} satisfies Meta<typeof SubscribeForm>;

export default meta;
type Story = StoryObj<typeof meta>;

// The two variants are a real layout fork — side by side at page width,
// stacked in the rail, because a 44px field and a 44px button will not both
// fit across four columns. Both need snapshots.
export const Page: Story = {
  args: { variant: "page" },
};

export const Rail: Story = {
  args: { variant: "rail" },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
};

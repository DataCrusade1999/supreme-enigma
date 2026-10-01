import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TerminalWindow } from "./TerminalWindow";

const meta = {
  title: "Site/TerminalWindow",
  component: TerminalWindow,
} satisfies Meta<typeof TerminalWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "bgm-looper — zsh",
    children: (
      <>
        <p>$ npm run build-storybook</p>
        <p>info =&gt; Building manager..</p>
      </>
    ),
  },
};

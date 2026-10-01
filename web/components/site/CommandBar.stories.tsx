import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CommandBar, openCommandBar } from "./CommandBar";

const meta = {
  title: "Site/CommandBar",
  component: CommandBar,
} satisfies Meta<typeof CommandBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Closed, the component renders nothing at all — a snapshot of it is a blank
// frame that would happily stay green through any regression. Opening it needs
// the same event ⌘K dispatches; a named component so React and ESLint both see
// a legitimate hook call site.
function OpenOnMount({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    openCommandBar();
  }, []);
  return <>{children}</>;
}

export const Open: Story = {
  decorators: [
    (Story) => (
      <OpenOnMount>
        <Story />
      </OpenOnMount>
    ),
  ],
};

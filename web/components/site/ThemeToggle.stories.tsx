import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ThemeToggle } from "./ThemeToggle";

const meta = {
  title: "Site/ThemeToggle",
  component: ThemeToggle,
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

// The component reads document.documentElement.classList.contains("dark") on
// mount and re-reads on THEME_CHANGE_EVENT. withSiteTheme's setTheme call
// fires that event after this mount, so each Chromatic mode shows the icon
// that matches its page — the two modes exercise both icon states from this
// single story.
export const Default: Story = {};

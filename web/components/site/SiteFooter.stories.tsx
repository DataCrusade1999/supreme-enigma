import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SiteFooter } from "./SiteFooter";

const meta = {
  title: "Site/SiteFooter",
  component: SiteFooter,
} satisfies Meta<typeof SiteFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

// Renders `© {new Date().getFullYear()}`, so this snapshot will diff once a
// year on 1 January. Accepted rather than mocked: a frozen date here would be
// one more thing to keep in sync with the component.
export const Default: Story = {};

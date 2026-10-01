import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FeaturedTool } from "./FeaturedTool";
import { projects } from "../../content/projects";

const meta = {
  title: "Site/FeaturedTool",
  component: FeaturedTool,
} satisfies Meta<typeof FeaturedTool>;

export default meta;
type Story = StoryObj<typeof meta>;

// The real project data, the same fixture FeaturedTool.test.tsx uses. A second
// set of sample copy would drift from what the home page actually renders.
export const Default: Story = {
  args: { project: projects[0] },
};

export const ShortDescription: Story = {
  args: {
    project: {
      slug: "example",
      name: "Example",
      description: "One line.",
      href: "/tools/example",
    },
  },
};

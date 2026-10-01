import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProjectDemoGif } from "./ProjectDemoGif";

const meta = {
  title: "Site/ProjectDemoGif",
  component: ProjectDemoGif,
} satisfies Meta<typeof ProjectDemoGif>;

export default meta;
type Story = StoryObj<typeof meta>;

// An inline SVG data URI, not a file or a URL. There is no web/public in this
// repo, and a remote image would make every Chromatic snapshot depend on a
// network fetch completing before capture.
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">' +
      '<rect width="640" height="360" fill="#146b64"/>' +
      '<text x="320" y="190" font-family="monospace" font-size="28" fill="#eceae5" text-anchor="middle">demo.gif</text>' +
      "</svg>",
  );

export const Default: Story = {
  args: {
    src: PLACEHOLDER,
    alt: "BGM Looper demo recording",
    width: 640,
    height: 360,
  },
};

export const Priority: Story = {
  args: {
    src: PLACEHOLDER,
    alt: "BGM Looper demo recording",
    width: 640,
    height: 360,
    priority: true,
  },
};

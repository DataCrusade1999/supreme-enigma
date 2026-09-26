import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HeadlineList } from "./HeadlineList";
import type { Headline } from "../../lib/news-desk/types";

const meta = {
  title: "News Desk/HeadlineList",
  component: HeadlineList,
} satisfies Meta<typeof HeadlineList>;

export default meta;
type Story = StoryObj<typeof meta>;

const headlines: Headline[] = [
  {
    id: "a",
    title: "Moody's raises India FY27 GDP forecast to 7%",
    url: "https://example.com/a",
    source: "Reuters",
    publishedAt: "2026-09-25T09:00:00.000Z",
    direct: false,
    tag: "Economy",
  },
  {
    id: "b",
    title: "Cabinet to decide on new BIT template",
    url: "https://example.com/b",
    source: "Mint",
    summary: "New template aims to ease investor–state dispute settlement.",
    publishedAt: "2026-09-25T08:00:00.000Z",
    direct: true,
    tag: "Legislation",
  },
];

export const Default: Story = {
  args: { headlines, now: new Date("2026-09-25T12:00:00.000Z") },
};

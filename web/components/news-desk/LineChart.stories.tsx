import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LineChart } from "./LineChart";

const meta = {
  title: "News Desk/LineChart",
  component: LineChart,
} satisfies Meta<typeof LineChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Monthly: Story = {
  args: {
    title: "IIP growth, General",
    unit: "%",
    points: [
      { period: "Jan 2026", value: 5.2 },
      { period: "Feb 2026", value: 2.9 },
      { period: "Mar 2026", value: 3.0 },
      { period: "Apr 2026", value: 2.7 },
      { period: "May 2026", value: 5.0 },
      { period: "Jun 2026", value: 8.8 },
      { period: "Jul 2026", value: 6.7 },
    ],
  },
};

export const SinglePoint: Story = {
  args: { title: "GDP growth (real)", unit: "%", points: [{ period: "Q1 2026-27", value: 7.8 }] },
};

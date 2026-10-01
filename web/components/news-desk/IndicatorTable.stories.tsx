import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IndicatorTable } from "./IndicatorTable";
import type { IndicatorValue } from "../../lib/news-desk/types";

const meta = {
  title: "News Desk/IndicatorTable",
  component: IndicatorTable,
} satisfies Meta<typeof IndicatorTable>;

export default meta;
type Story = StoryObj<typeof meta>;

const indicators: IndicatorValue[] = [
  {
    id: "cpi-headline",
    label: "Retail inflation",
    unit: "%",
    period: "Aug 2026",
    latest: 4.82,
    prevPeriod: "Jul 2026",
    prev: 4.45,
    lastGoodAt: "2026-09-26T11:00:00.000Z",
  },
  {
    id: "iip",
    label: "IIP growth",
    unit: "%",
    period: "Jul 2026",
    latest: 6.7,
    prevPeriod: "Jun 2026",
    prev: 8.8,
    lastGoodAt: "2026-09-20T11:00:00.000Z",
    error: "MoSPI status 503",
  },
  {
    id: "gdp",
    label: "GDP growth (real)",
    unit: "%",
    period: null,
    latest: null,
    prevPeriod: null,
    prev: null,
    lastGoodAt: null,
    error: "MoSPI rejected the query: Invalid parameters",
  },
];

export const Default: Story = {
  args: { indicators, now: new Date("2026-09-26T12:00:00.000Z") },
};

export const Empty: Story = {
  args: { indicators: [], now: new Date("2026-09-26T12:00:00.000Z") },
};

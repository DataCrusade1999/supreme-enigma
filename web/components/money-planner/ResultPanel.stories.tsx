import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ResultPanel } from "./ResultPanel";

const meta = {
  title: "MoneyPlanner/ResultPanel",
  component: ResultPanel,
  args: { targetName: "Camera", today: "2026-09-19" },
} satisfies Meta<typeof ResultPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ADate: Story = {
  args: {
    result: {
      kind: "date",
      date: "2027-03-04",
      balanceThen: 125000,
      timeline: [
        { date: "2026-10-01", label: "Salary", delta: 80000, balanceAfter: 80000 },
        { date: "2026-10-04", label: "Wifi", delta: -1800, balanceAfter: 78200 },
      ],
    },
  },
};

export const Already: Story = {
  args: { result: { kind: "already" } },
};

export const Short: Story = {
  args: { result: { kind: "unreachable", reason: "negative", monthlyNet: -4200 } },
};

export const PastTheHorizon: Story = {
  args: { result: { kind: "unreachable", reason: "horizon", monthlyNet: 1000 } },
};

export const NotReady: Story = {
  args: {
    result: { kind: "invalid", problems: ["Pay day must be a whole day between 1 and 31"] },
  },
};

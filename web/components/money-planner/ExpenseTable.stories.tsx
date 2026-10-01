import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ExpenseTable } from "./ExpenseTable";

const meta = {
  title: "MoneyPlanner/ExpenseTable",
  component: ExpenseTable,
  args: { today: "2026-09-19", onChange: () => {} },
} satisfies Meta<typeof ExpenseTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { expenses: [] },
};

export const MixedCadences: Story = {
  args: {
    expenses: [
      { id: "e1", name: "Rent", amount: 20000, everyMonths: 1, nextDue: "2026-10-01" },
      { id: "e2", name: "Wifi", amount: 1800, everyMonths: 3, nextDue: "2026-10-04" },
      { id: "e3", name: "Insurance", amount: 12000, everyMonths: 12, nextDue: "2027-01-15" },
    ],
  },
};

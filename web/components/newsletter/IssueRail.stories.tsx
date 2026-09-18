import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IssueRail } from "./IssueRail";

const meta = {
  title: "Newsletter/IssueRail",
  component: IssueRail,
} satisfies Meta<typeof IssueRail>;

export default meta;
type Story = StoryObj<typeof meta>;

const newer = { slug: "issue-003", title: "Three branches", date: "2026-10-01" };
const older = { slug: "issue-001", title: "Shipping the looper", date: "2026-08-01" };

export const BothNeighbours: Story = {
  args: { sentDate: "1 September 2026", newer, older },
};

// The newest issue: the component filters nulls out of the neighbour list, so
// this is the layout the most-recent issue actually gets.
export const NewestIssue: Story = {
  args: { sentDate: "1 October 2026", newer: null, older },
};

export const OnlyIssue: Story = {
  args: { sentDate: "1 August 2026", newer: null, older: null },
};

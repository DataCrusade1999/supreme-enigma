import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IssueList, type IssueListItem } from "./IssueList";

const meta = {
  title: "Newsletter/IssueList",
  component: IssueList,
} satisfies Meta<typeof IssueList>;

export default meta;
type Story = StoryObj<typeof meta>;

const issues: IssueListItem[] = [
  {
    slug: "issue-002",
    title: "What a slow machine teaches you about CI",
    date: "2026-09-01",
    summary: "Moving every expensive loop off the laptop, one job at a time.",
  },
  {
    slug: "issue-001",
    title: "Shipping the looper",
    date: "2026-08-01",
    summary: "Three branches, three Lambdas, one ECR repo.",
  },
];

export const Default: Story = {
  args: { issues },
};

// Rows span to column 12 here rather than stopping at 9 like BlogList — there
// is no tag column. Worth its own long-title story for that reason.
export const LongTitle: Story = {
  args: {
    issues: [
      {
        ...issues[0],
        title:
          "What a slow development machine teaches you about where the expensive work belongs",
      },
    ],
  },
};

export const Empty: Story = {
  args: { issues: [] },
};

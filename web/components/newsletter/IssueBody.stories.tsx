import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IssueBody } from "./IssueBody";
import { IssueRail } from "./IssueRail";

const meta = {
  title: "Newsletter/IssueBody",
  component: IssueBody,
} satisfies Meta<typeof IssueBody>;

export default meta;
type Story = StoryObj<typeof meta>;

const children = (
  <>
    <p>
      The laptop is slow. That is not a complaint, it is a constraint, and it
      turns out to be a useful one.
    </p>
    <p>Every loop worth running more than twice belongs on someone else&apos;s computer.</p>
  </>
);

export const WithRail: Story = {
  args: {
    title: "What a slow machine teaches you about CI",
    date: "2026-09-01",
    children,
    rail: (
      <IssueRail
        sentDate="1 September 2026"
        newer={null}
        older={{ slug: "issue-001", title: "Shipping the looper", date: "2026-08-01" }}
      />
    ),
  },
};

// The rail is optional and the reading column reflows to full width without it.
export const WithoutRail: Story = {
  args: {
    title: "What a slow machine teaches you about CI",
    date: "2026-09-01",
    children,
  },
};

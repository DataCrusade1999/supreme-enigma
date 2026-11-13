// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { sendApproved, sendEnded, sendGrants } from "./access-mail";

const ses = mockClient(SESv2Client);
const user = { sub: "u1", username: "Google_1", email: "jane@example.com", createdAt: "", groups: ["friends"] };

beforeEach(() => {
  ses.reset();
  process.env.ACCESS_FROM_EMAIL = "access@ashutosh-pandey.com";
  process.env.APP_AWS_REGION = "us-east-1";
});

describe("access emails", () => {
  it("sends the approval from and replying to the access address", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    expect(await sendApproved(user)).toBeNull();
    const input = ses.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.FromEmailAddress).toBe("Access <access@ashutosh-pandey.com>");
    expect(input.ReplyToAddresses).toEqual(["access@ashutosh-pandey.com"]);
    expect(input.Destination).toEqual({ ToAddresses: ["jane@example.com"] });
    expect(input.Content?.Simple?.Subject?.Data).toBe("You can now use the tools on ashutosh-pandey.com");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("BGM Looper, Money Planner and News Desk");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("https://ashutosh-pandey.com/tools");
  });

  it("lists every live grant, with uses left and the last day", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendGrants(user, [
      { sub: "u1", action: "newsdesk:ask", email: "", limit: 20, used: 0, expiresAt: 1_791_504_000, grantedAt: 0 },
      { sub: "u1", action: "looper:process", email: "", limit: 5, used: 2, expiresAt: 1_791_504_000, grantedAt: 0 },
    ]);
    const text = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content?.Simple?.Body?.Text?.Data;
    expect(text).toContain("News Desk ask: 20 uses, until 9 Oct 2026");
    expect(text).toContain("BGM Looper processing: 3 uses, until 9 Oct 2026");
  });

  it("says what ended", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendEnded(user, "News Desk ask");
    expect(ses.commandCalls(SendEmailCommand)[0].args[0].input.Content?.Simple?.Body?.Text?.Data).toContain(
      "Your access to News Desk ask on ashutosh-pandey.com has ended.",
    );
  });

  it("returns SES's error instead of throwing, e.g. in the sandbox", async () => {
    ses.on(SendEmailCommand).rejects(Object.assign(new Error("Email address is not verified."), { name: "MessageRejected" }));
    expect(await sendApproved(user)).toBe("MessageRejected: Email address is not verified.");
  });

  it("sends nothing to a user without an email address", async () => {
    expect(await sendApproved({ ...user, email: "" })).toBe("this account has no email address");
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it("sends nothing when ACCESS_FROM_EMAIL is not set", async () => {
    delete process.env.ACCESS_FROM_EMAIL;
    expect(await sendApproved(user)).toBe("ACCESS_FROM_EMAIL is not set");
  });
});

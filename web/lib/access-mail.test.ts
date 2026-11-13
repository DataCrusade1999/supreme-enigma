// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { sendEnded, sendUpdate, sendWelcome } from "./access-mail";
import type { Grant } from "./authz/grants";

const ses = mockClient(SESv2Client);
const user = { sub: "u1", username: "Google_1", email: "jane@example.com", createdAt: "", groups: ["friends"] };

const newsdesk: Grant = { sub: "u1", action: "newsdesk:ask", email: "", limit: 20, used: 0, expiresAt: 1_795_180_380, grantedAt: 0 };
const planner: Grant = { sub: "u1", action: "moneyplanner:use", email: "", expiresAt: 1_795_180_380, grantedAt: 0 };
const sent = () => ses.commandCalls(SendEmailCommand)[0].args[0].input;

beforeEach(() => {
  ses.reset();
  process.env.ACCESS_FROM_EMAIL = "access@ashutosh-pandey.com";
  process.env.APP_AWS_REGION = "us-east-1";
});

describe("access emails", () => {
  it("says what ended", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendEnded(user, "News Desk ask");
    const input = sent();
    expect(input.Content?.Simple?.Subject?.Data).toBe("Your access on ashutosh-pandey.com has ended");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("Your access to News Desk ask on ashutosh-pandey.com has ended.");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("Questions? Reply to this email.");
  });

  it("welcomes with the grant just made", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    expect(await sendWelcome(user, newsdesk)).toBeNull();
    const input = sent();
    expect(input.FromEmailAddress).toBe("Ashutosh Pandey <access@ashutosh-pandey.com>");
    expect(input.ReplyToAddresses).toEqual(["access@ashutosh-pandey.com"]);
    expect(input.Content?.Simple?.Subject?.Data).toBe("Welcome. News Desk is ready for you");
    const text = input.Content?.Simple?.Body?.Text?.Data;
    expect(text).toContain("Welcome, and thank you for signing in.");
    expect(text).toContain("News Desk ask · 20 uses · until 20 Nov 2026, 6:43 pm IST");
    expect(text).toContain("https://ashutosh-pandey.com/tools/news-desk");
    expect(text).toContain("Your access is always shown at ashutosh-pandey.com/tools.");
    expect(text).toContain("Questions, or want more uses? Reply to this email.");
    expect(input.Content?.Simple?.Body?.Html?.Data).toContain("Open News Desk");
  });

  it("counts remaining uses, singular for one", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendWelcome(user, { ...newsdesk, limit: 5, used: 4 });
    expect(sent().Content?.Simple?.Body?.Text?.Data).toContain("News Desk ask · 1 use · until");
  });

  it("gives a time-only grant no uses", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendWelcome(user, planner);
    const text = sent().Content?.Simple?.Body?.Text?.Data;
    expect(text).toContain("Money Planner\nuntil 20 Nov 2026, 6:43 pm IST\n");
    expect(text).not.toContain(" uses ");
    expect(text).not.toContain(" use ·");
  });

  it("never includes the note", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendWelcome(user, { ...newsdesk, note: "secret note" });
    const body = sent().Content?.Simple?.Body;
    expect(body?.Text?.Data).not.toContain("secret note");
    expect(body?.Html?.Data).not.toContain("secret note");
  });

  it("titles an update by whether it opens the tool", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendUpdate(user, newsdesk, true);
    let input = sent();
    expect(input.Content?.Simple?.Subject?.Data).toBe("You can now use News Desk");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("One more tool is open to you.");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("Everything else you had stays as it was.");
    ses.reset();
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });
    await sendUpdate(user, newsdesk, false);
    input = sent();
    expect(input.Content?.Simple?.Subject?.Data).toBe("Your access to News Desk has changed");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("Your access to News Desk has changed.");
    expect(input.Content?.Simple?.Body?.Text?.Data).toContain("Questions? Reply to this email.");
  });

  it("returns SES's error instead of throwing, e.g. in the sandbox", async () => {
    ses.on(SendEmailCommand).rejects(Object.assign(new Error("Email address is not verified."), { name: "MessageRejected" }));
    expect(await sendWelcome(user, newsdesk)).toBe("MessageRejected: Email address is not verified.");
  });

  it("sends nothing to a user without an email address", async () => {
    expect(await sendWelcome({ ...user, email: "" }, newsdesk)).toBe("this account has no email address");
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it("sends nothing when ACCESS_FROM_EMAIL is not set", async () => {
    delete process.env.ACCESS_FROM_EMAIL;
    expect(await sendWelcome(user, newsdesk)).toBe("ACCESS_FROM_EMAIL is not set");
  });
});

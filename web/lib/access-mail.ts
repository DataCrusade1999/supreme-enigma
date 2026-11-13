import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { awsCredentials } from "./aws";
import type { AccessUser } from "./access-admin";
import type { Grant } from "./authz/grants";
import { GRANTS } from "./route-gate";

const SITE = "https://ashutosh-pandey.com";

let client: SESv2Client | null = null;
const ses = () => (client ??= new SESv2Client({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }));

const day = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Null when sent; otherwise why not. A failed email never undoes the change
 * that triggered it: the Access page shows the reason instead. */
async function send(to: string, subject: string, lines: string[]): Promise<string | null> {
  const from = process.env.ACCESS_FROM_EMAIL;
  if (!from) return "ACCESS_FROM_EMAIL is not set";
  if (!to) return "this account has no email address";
  const text = [...lines, "", "Reply to this email if you have a question."].join("\n");
  const html = text
    .split("\n\n")
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  try {
    await ses().send(
      new SendEmailCommand({
        FromEmailAddress: `Access <${from}>`,
        ReplyToAddresses: [from],
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: text }, Html: { Data: html } },
          },
        },
      }),
    );
    return null;
  } catch (err) {
    const e = err as Error;
    console.error("access: email failed", e);
    return `${e.name}: ${e.message}`;
  }
}

export function sendApproved(user: AccessUser): Promise<string | null> {
  return send(user.email, "You can now use the tools on ashutosh-pandey.com", [
    "You've been given access to BGM Looper, Money Planner and News Desk.",
    "",
    `Sign in at ${SITE}/tools with the same Google account.`,
    "",
    "Anything that costs money to run (the News Desk assistant and refresh, BGM Looper processing) needs a separate grant. Reply to ask for one.",
  ]);
}

export function sendGrants(user: AccessUser, grants: Grant[]): Promise<string | null> {
  const lines = grants.map((g) => `${GRANTS[g.action].label}: ${(g.limit ?? 0) - (g.used ?? 0)} uses, until ${day(g.expiresAt)}`);
  return send(user.email, "Your grants on ashutosh-pandey.com", [
    "You can now use:",
    "",
    ...lines,
    "",
    `Your remaining uses are shown at ${SITE}/tools.`,
  ]);
}

export function sendEnded(user: AccessUser, what: string): Promise<string | null> {
  return send(user.email, "Your access on ashutosh-pandey.com has ended", [
    `Your access to ${what} on ashutosh-pandey.com has ended.`,
  ]);
}

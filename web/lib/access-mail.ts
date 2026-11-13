import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { awsCredentials } from "./aws";
import type { AccessUser } from "./access-admin";
import type { Grant } from "./authz/grants";
import { GRANTS, TOOLS, toolHref } from "./route-gate";
import { formatUntil, formatUses } from "./access-format";
import { renderEmail, type EmailParts } from "./access-mail-layout";

const SITE = "https://ashutosh-pandey.com";

let client: SESv2Client | null = null;
const ses = () => (client ??= new SESv2Client({ region: process.env.APP_AWS_REGION!, ...awsCredentials() }));

const day = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Null when sent; otherwise why not. A failed email never undoes the change
 * that triggered it: the Access page shows the reason instead. */
async function deliver(to: string, subject: string, body: { html: string; text: string }): Promise<string | null> {
  const from = process.env.ACCESS_FROM_EMAIL;
  if (!from) return "ACCESS_FROM_EMAIL is not set";
  if (!to) return "this account has no email address";
  try {
    await ses().send(
      new SendEmailCommand({
        FromEmailAddress: `Ashutosh Pandey <${from}>`,
        ReplyToAddresses: [from],
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: body.text }, Html: { Data: body.html } },
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

function send(to: string, subject: string, lines: string[]): Promise<string | null> {
  const text = [...lines, "", "Reply to this email if you have a question."].join("\n");
  const html = text
    .split("\n\n")
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return deliver(to, subject, { html, text });
}

const toolOf = (g: Grant) => TOOLS.find((t) => t.id === GRANTS[g.action].tool)!;

function grantRow(g: Grant): EmailParts["rows"][number] {
  const tool = toolOf(g);
  const until = `until ${formatUntil(g.expiresAt)}`;
  const detail = GRANTS[g.action].metered
    ? `${GRANTS[g.action].label} · ${formatUses((g.limit ?? 0) - (g.used ?? 0))} · ${until}`
    : until;
  return { tool: tool.name, detail, button: { label: `Open ${tool.name}`, href: `${SITE}${toolHref(tool.id)}` } };
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

export function sendWelcome(user: AccessUser, grant: Grant): Promise<string | null> {
  return deliver(
    user.email,
    `Welcome. ${toolOf(grant).name} is ready for you`,
    renderEmail({
      heading: "Welcome, and thank you for signing in.",
      intro:
        "Thanks for trying the tools on my site. I've opened the one below for you. Sign in with the same Google account you used before.",
      rows: [grantRow(grant)],
      after: "Your access is always shown at ashutosh-pandey.com/tools.",
      footer: [
        "Questions, or want more uses? Reply to this email.",
        "You're getting this because you signed in at ashutosh-pandey.com and were given access.",
      ],
    }),
  );
}

export function sendUpdate(user: AccessUser, grant: Grant, opensTool: boolean): Promise<string | null> {
  const name = toolOf(grant).name;
  return deliver(
    user.email,
    opensTool ? `You can now use ${name}` : `Your access to ${name} has changed`,
    renderEmail({
      heading: opensTool ? "One more tool is open to you." : `Your access to ${name} has changed.`,
      rows: [grantRow(grant)],
      after: "Everything else you had stays as it was.",
      footer: ["Questions? Reply to this email."],
    }),
  );
}

export function sendEnded(user: AccessUser, what: string): Promise<string | null> {
  return deliver(
    user.email,
    "Your access on ashutosh-pandey.com has ended",
    renderEmail({
      heading: `Your access to ${what} on ashutosh-pandey.com has ended.`,
      rows: [],
      footer: ["Questions? Reply to this email."],
    }),
  );
}

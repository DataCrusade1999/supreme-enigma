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

const toolOf = (g: Grant) => TOOLS.find((t) => t.id === GRANTS[g.action].tool)!;

function grantRow(g: Grant): EmailParts["rows"][number] {
  const tool = toolOf(g);
  const until = `until ${formatUntil(g.expiresAt)}`;
  const detail = GRANTS[g.action].metered
    ? `${GRANTS[g.action].label} · ${formatUses((g.limit ?? 0) - (g.used ?? 0))} · ${until}`
    : until;
  return { tool: tool.name, detail, button: { label: `Open ${tool.name}`, href: `${SITE}${toolHref(tool.id)}` } };
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

import Link from "next/link";
import { ACCESS_EMAIL, requestAccessHref } from "../../lib/authz/access-request";
import { TOOLS } from "../../lib/route-gate";

const MESSAGES: Record<string, string> = {
  forbidden: "This account can't open that.",
  no_grant: "That uses paid services, and needs a separate grant.",
  quota_exhausted: "You've used every run your grant allowed.",
  grant_expired: "Your grant for that has expired.",
  authorization_unavailable: "Access can't be checked right now.",
};

const TOOL_NAMES: Record<string, string> = { hub: "Tools hub", ...Object.fromEntries(TOOLS.map((t) => [t.id, t.name])) };
// Only the action shapes the gate produces; anything else is dropped from the subject.
const ACTION = /^[a-z]+(:[a-z]+)?$/;

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { reason, tool, action } = await searchParams;
  const message = (typeof reason === "string" && MESSAGES[reason]) || MESSAGES.forbidden;
  const toolName = typeof tool === "string" ? TOOL_NAMES[tool] : undefined;
  const actionId = typeof action === "string" && ACTION.test(action) ? action : undefined;
  const subject = ["Access request:", toolName, actionId].filter(Boolean).join(" ");

  return (
    <main className="flex min-h-screen flex-col px-5 py-14 font-ui sm:px-10">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">Tools</p>
      <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">Not available</h1>
      <div className="mt-5 border-b-2 border-rule-heavy" />
      <p className="mt-[18px] max-w-[52ch] text-base leading-relaxed text-fg">{message}</p>
      {reason !== "authorization_unavailable" ? (
        <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-muted">
          To ask for it, write to{" "}
          <a href={requestAccessHref(subject)} className="text-accent hover:text-fg">
            {ACCESS_EMAIL}
          </a>
          .
        </p>
      ) : null}
      <p className="mt-9 text-[0.8125rem] text-muted">
        Back to{" "}
        <Link href="/tools" className="text-accent hover:text-fg">
          your tools
        </Link>
        .
      </p>
    </main>
  );
}

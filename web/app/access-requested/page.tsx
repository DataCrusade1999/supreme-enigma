import Link from "next/link";
import { ACCESS_EMAIL, requestAccessHref } from "../../lib/authz/access-request";

// Outside the (site) group like /login: the visitor is signed in but has been
// given nothing yet, so there is no nav into the tools.
export default function AccessRequestedPage() {
  return (
    <main className="flex min-h-screen flex-col px-5 py-14 font-ui sm:px-10">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">Tools</p>
      <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">Access requested</h1>
      <div className="mt-5 border-b-2 border-rule-heavy" />
      <p className="mt-[18px] max-w-[52ch] text-base leading-relaxed text-muted">
        You&apos;re signed in, but this account hasn&apos;t been given access yet. Write to{" "}
        <a href={requestAccessHref("Access request")} className="text-accent hover:text-fg">
          {ACCESS_EMAIL}
        </a>{" "}
        with who you are and what you&apos;d like to try.
      </p>
      <p className="mt-9 text-[0.8125rem] text-muted">
        Back to the{" "}
        <Link href="/" className="text-accent hover:text-fg">
          public site
        </Link>
        .
      </p>
    </main>
  );
}

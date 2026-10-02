"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CommandBar } from "../../components/site/CommandBar";
import { GridBackdrop } from "../../components/site/GridBackdrop";
import { LoopRing } from "../../components/site/LoopRing";
import { toolNameFor } from "../../lib/route-gate";

// The hub, not a tool: a sign-in with no destination hasn't said where it's going, and
// the copy below promises every tool opens — landing on one of them picks for
// the visitor. A visit that *did* say (a `next`) still goes straight through.
const FALLBACK = "/tools";

// Null rather than the fallback when `next` is missing or off-origin, so the
// caller can tell "go here" from "we don't know where you were headed" — the
// destination strip only renders for the former.
//
// `full` and `pathname` are both returned because they have different jobs:
// the redirect has to carry any query and hash through, while toolNameFor()
// matches prefixes on a "/" boundary, so `/keystatic?path=posts` would match
// nothing if it were handed the composite string. Splitting here keeps
// route-gate a pure-pathname helper, the way proxy.ts already calls it.
function parseNext(
  v: string | null,
): { full: string; pathname: string } | null {
  if (!v) return null;
  try {
    const url = new URL(v, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return {
      full: url.pathname + url.search + url.hash,
      pathname: url.pathname,
    };
  } catch {
    return null;
  }
}

const ERRORS: Record<string, string> = {
  state: "That sign-in expired or came from another tab. Try again.",
  denied: "Sign-in was cancelled.",
  failed: "Sign-in failed. Try again.",
};

function LoginForm() {
  const searchParams = useSearchParams();
  const next = parseNext(searchParams.get("next"));
  const destination = next ? toolNameFor(next.pathname) : null;
  const error = ERRORS[searchParams.get("error") ?? ""] ?? null;
  const href = `/api/auth/login?next=${encodeURIComponent(next?.full ?? FALLBACK)}`;

  return (
    <>
      {destination ? (
        <div className="mt-[26px] flex items-center gap-3">
          <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
            Continuing to
          </span>
          <svg
            aria-hidden="true"
            width="18"
            height="10"
            viewBox="0 0 18 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-accent"
          >
            <path d="M0 5h16" />
            <path d="M12.5 1.5 16 5l-3.5 3.5" />
          </svg>
          <span className="text-[0.9375rem] font-semibold tracking-tight">
            {destination}
          </span>
        </div>
      ) : null}

      <p className="mt-[18px] max-w-[46ch] text-base leading-relaxed text-muted">
        {destination
          ? "These tools are for the site's owner. Sign in with Google, an email code or a passkey to continue."
          : "These tools are for the site's owner. Sign in with Google, an email code or a passkey, and every tool on this site opens for the session."}
      </p>

      <div className="mt-9 flex flex-col gap-3.5">
        {/* A plain link, not a fetch: the sign-in is a chain of full-page
          * redirects through Cognito and back to /api/auth/callback. */}
        <a
          href={href}
          className="inline-flex min-h-11 w-fit items-center bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
        >
          Sign in
        </a>
        {error && (
          <p role="alert" className="flex items-center gap-2 text-[0.8125rem] text-peak">
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v6" />
              <path d="M12 16.5v.01" />
            </svg>
            {error}
          </p>
        )}
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    // `/login` sits outside the `(site)` route group on purpose: the gate gets
    // the root layout only, so there's no SiteHeader nav back into the pages a
    // visitor hasn't unlocked. The wordmark below is the whole way out.
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
          Restricted
        </span>
      </header>

      {/* The gate is one short block on an otherwise empty page, so it centres
        * in the remaining height rather than hanging off the masthead the way
        * the content-bearing portfolio pages do. */}
      <main className="relative isolate flex flex-1 items-center px-5 py-14 sm:px-10">
        <GridBackdrop />
        <div className="grid w-full grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-7">
            <p className="text-xs uppercase tracking-[0.14em] text-muted">
              Private
            </p>
            <h1 className="mt-3 font-display text-5xl leading-[0.95] sm:text-[5.25rem]">
              Sign in
            </h1>
            <div className="mt-5 border-b-2 border-rule-heavy" />

            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>

            <p className="mt-10 text-[0.8125rem] text-muted">
              Everything else — projects, writing, resume — is{" "}
              <Link href="/" className="text-accent hover:text-fg">
                open, over here
              </Link>
              .
            </p>
          </div>

          <div className="col-span-12 hidden flex-col items-center gap-7 lg:col-span-5 lg:flex">
            <LoopRing seam={false} />
            <p className="max-w-[28ch] text-center text-[0.8125rem] leading-relaxed text-muted">
              Small tools, built for one job each, kept behind one door.
            </p>
          </div>
        </div>
      </main>

      {/* The gate has no SiteHeader, so ⌘K is the only nav here beyond the
        * wordmark — which is exactly why it's worth having. Rendered directly
        * rather than inherited, since /login is outside the (site) group. */}
      <CommandBar />
    </div>
  );
}

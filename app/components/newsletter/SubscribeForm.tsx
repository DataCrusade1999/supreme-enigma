const BUTTONDOWN_USERNAME = "DataCrusade1999";

export function SubscribeForm({
  variant = "page",
}: {
  variant?: "page" | "rail";
}) {
  const isRail = variant === "rail";

  return (
    <form
      aria-label="Subscribe to the newsletter"
      method="post"
      action={`https://buttondown.com/api/emails/embed-subscribe/${BUTTONDOWN_USERNAME}`}
      target="_blank"
      className={
        isRail
          ? "mt-6 flex flex-col gap-3.5 border-t border-line pt-5"
          : "mt-12 flex flex-col gap-3.5 border-t-2 border-rule-heavy pt-8"
      }
    >
      <label
        htmlFor="bd-email"
        className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted"
      >
        Get new issues by email
      </label>
      {/* Side by side at page width, stacked in the rail — a 44px-tall field and
        * a 44px-tall button will not both fit across four columns. */}
      <div className={isRail ? "flex flex-col gap-3" : "flex items-stretch gap-3"}>
        <input
          id="bd-email"
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          className={
            isRail
              ? "min-h-11 w-full border border-line px-3 text-sm text-fg placeholder:text-muted"
              : "min-h-11 w-full max-w-80 border border-line px-3 text-sm text-fg placeholder:text-muted"
          }
        />
        <button
          type="submit"
          className="min-h-11 shrink-0 bg-fg px-5 text-sm font-semibold tracking-tight text-bg transition-colors duration-200 ease-out hover:bg-accent motion-reduce:transition-none"
        >
          Subscribe
        </button>
      </div>
    </form>
  );
}

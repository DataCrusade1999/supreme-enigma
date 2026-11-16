const BUTTONDOWN_API_BASE = "https://api.buttondown.com/v1";

function getApiKey(): string {
  const key = process.env.BUTTONDOWN_API_KEY;
  if (!key) {
    throw new Error("BUTTONDOWN_API_KEY is not set");
  }
  return key;
}

/**
 * Whether the Buttondown integration is configured at all.
 *
 * Deliberately separate from `getApiKey()` throwing: the admin page renders a
 * row per issue and catches per row, so an unset key would otherwise surface as
 * N identical failures flattened into "status unknown" — the same thing it
 * shows when an issue simply has not been sent. Asking this once up front lets
 * the page name the actual problem, and skips a fan-out of calls that are all
 * going to throw.
 */
export function isButtondownConfigured(): boolean {
  return Boolean(process.env.BUTTONDOWN_API_KEY);
}

function headers(): Record<string, string> {
  return {
    Authorization: `Token ${getApiKey()}`,
    "Content-Type": "application/json",
    "X-API-Version": "2026-04-01",
  };
}

type ButtondownEmail = {
  id: string;
  slug: string | null;
  subject: string;
  status: string;
};

type ButtondownEmailPage = {
  results: ButtondownEmail[];
  next: string | null;
};

/** Pages walked before giving up (#132). Far past any real archive; a cursor
 * that keeps returning `next` past it is a Buttondown fault, not a long list. */
export const MAX_PAGES = 100;
/** Retries of a 429 before it is reported, waiting 1 s, 2 s, then 4 s (or the
 * server's Retry-After, capped at 10 s). */
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(url: string): Promise<ButtondownEmailPage> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: headers() });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers?.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Buttondown list emails failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }
}

// Every email, not `?status=sent`. A just-triggered send sits in
// `about_to_send`, `throttled` or `in_flight` for a while before it becomes
// `sent`, so filtering on `sent` would report an in-flight issue as unsent
// and let a second click send it twice — the exact failure this guard exists
// to prevent. Any email carrying the slug counts, whatever state it's in.
// `GET /v1/emails` has no slug filter, so the list is filtered here.
async function* emails(): AsyncGenerator<ButtondownEmail> {
  let url: string | null = `${BUTTONDOWN_API_BASE}/emails?excluded_fields=body`;
  for (let page = 0; url; page++) {
    // Throws rather than returning what it has: a truncated list would report
    // a sent issue as unsent, and unsent is what offers the Send button.
    if (page === MAX_PAGES) throw new Error(`Buttondown list emails passed ${MAX_PAGES} pages`);
    const body = await fetchPage(url);
    yield* body.results;
    url = body.next;
  }
}

export async function isIssueSent(slug: string): Promise<boolean> {
  for await (const email of emails()) {
    if (email.slug === slug) return true;
  }
  return false;
}

/** The slug of every email in Buttondown, in one walk of the list. The admin
 * page checks all its issues against this instead of walking the list once per
 * issue (#132). */
export async function listEmailSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  for await (const email of emails()) {
    if (email.slug) slugs.add(email.slug);
  }
  return slugs;
}

export async function sendIssue({
  slug,
  subject,
  body,
}: {
  slug: string;
  subject: string;
  body: string;
}): Promise<void> {
  const res = await fetch(`${BUTTONDOWN_API_BASE}/emails`, {
    method: "POST",
    headers: {
      ...headers(),
      "X-Buttondown-Live-Dangerously": "true",
    },
    body: JSON.stringify({
      subject,
      slug,
      body,
      status: "about_to_send",
    }),
  });
  if (res.status !== 201) {
    throw new Error(`Buttondown send failed: ${res.status} ${await res.text()}`);
  }
}

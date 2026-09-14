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

export async function isIssueSent(slug: string): Promise<boolean> {
  // Every email, not `?status=sent`. A just-triggered send sits in
  // `about_to_send`, `throttled` or `in_flight` for a while before it becomes
  // `sent`, so filtering on `sent` would report an in-flight issue as unsent
  // and let a second click send it twice — the exact failure this guard exists
  // to prevent. Any email carrying the slug counts, whatever state it's in.
  let url: string | null = `${BUTTONDOWN_API_BASE}/emails?excluded_fields=body`;
  while (url) {
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      throw new Error(`Buttondown list emails failed: ${res.status} ${await res.text()}`);
    }
    const page: ButtondownEmailPage = await res.json();
    if (page.results.some((email) => email.slug === slug)) {
      return true;
    }
    url = page.next;
  }
  return false;
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

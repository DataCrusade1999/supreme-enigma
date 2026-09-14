const BUTTONDOWN_API_BASE = "https://api.buttondown.com/v1";

function getApiKey(): string {
  const key = process.env.BUTTONDOWN_API_KEY;
  if (!key) {
    throw new Error("BUTTONDOWN_API_KEY is not set");
  }
  return key;
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

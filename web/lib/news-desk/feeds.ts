import { withId } from "./dedupe";
import { parseFeed } from "./parse";
import type { Headline, Region, SourceDef, SourceError } from "./types";

export const FEED_TIMEOUT_MS = 8000;

// Some publishers refuse requests with no User-Agent.
const USER_AGENT = "Mozilla/5.0 (compatible; NewsDesk/1.0)";

function googleNews(name: string, query: string, region: Region): SourceDef {
  const q = encodeURIComponent(`${query} when:7d`);
  return {
    name,
    url: `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`,
    kind: "google",
    summary: false,
    region,
  };
}

// Checked by hand on 2026-09-25; see the design spec §5.1 for what each returned
// and why The Economist, PRS, PIB, Reuters and Bloomberg go through Google News.
export const SOURCES: SourceDef[] = [
  { name: "FT", url: "https://www.ft.com/world/asia-pacific/india?format=rss", kind: "direct", summary: true, region: "international" },
  { name: "RBI press releases", url: "https://www.rbi.org.in/pressreleases_rss.xml", kind: "direct", summary: false, region: "local" },
  { name: "RBI notifications", url: "https://www.rbi.org.in/notifications_rss.xml", kind: "direct", summary: false, region: "local" },
  { name: "SEBI", url: "https://www.sebi.gov.in/sebirss.xml", kind: "direct", summary: false, region: "local" },
  { name: "Mint", url: "https://www.livemint.com/rss/economy", kind: "direct", summary: true, region: "local" },
  { name: "Business Standard", url: "https://www.business-standard.com/rss/economy-102.rss", kind: "direct", summary: true, region: "local" },
  googleNews("Google News: Reuters", "site:reuters.com India economy", "international"),
  googleNews("Google News: Bloomberg", "site:bloomberg.com India", "international"),
  googleNews("Google News: The Economist", "site:economist.com India", "international"),
  googleNews("Google News: PRS", "site:prsindia.org", "local"),
  // Unfiltered, site:pib.gov.in returns the 100-item cap every time, mostly
  // ministry notices unrelated to the economy. Narrowed to the topics this desk covers.
  googleNews(
    "Google News: PIB",
    "site:pib.gov.in (Cabinet OR economy OR bill OR GDP OR inflation OR GST OR reform OR RBI)",
    "local",
  ),
  googleNews(
    "Google News: legislation",
    'India (bill OR ordinance OR amendment) ("Lok Sabha" OR "Rajya Sabha")',
    "local",
  ),
  googleNews(
    "Google News: reforms",
    'India ("Cabinet approves" OR "GST Council" OR "labour codes" OR disinvestment OR reform)',
    "local",
  ),
];

async function fetchOne(source: SourceDef, fetchImpl: typeof fetch, timeoutMs: number): Promise<Headline[]> {
  let res: Response;
  try {
    res = await fetchImpl(source.url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "timed out" : "network error");
  }
  if (!res.ok) throw new Error(`status ${res.status}`);
  return parseFeed(await res.text(), source).map(withId);
}

export async function fetchAllFeeds(
  options: { sources?: SourceDef[]; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ headlines: Headline[]; errors: SourceError[] }> {
  const { sources = SOURCES, fetchImpl = fetch, timeoutMs = FEED_TIMEOUT_MS } = options;
  const results = await Promise.allSettled(sources.map((s) => fetchOne(s, fetchImpl, timeoutMs)));

  const headlines: Headline[] = [];
  const errors: SourceError[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") headlines.push(...result.value);
    else errors.push({ source: sources[i].name, message: (result.reason as Error).message });
  });
  return { headlines, errors };
}

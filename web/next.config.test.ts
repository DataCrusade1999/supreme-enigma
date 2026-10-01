import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "./next.config.mjs";

const header = async (name: string) => {
  const rules = (await nextConfig.headers?.()) ?? [];
  return rules
    .flatMap((rule) => rule.headers)
    .find((h) => h.key.toLowerCase() === name)?.value;
};

const robotsHeader = () => header("x-robots-tag");

describe("security headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["production", "preview"])("are sent on %s", async (env) => {
    vi.stubEnv("VERCEL_ENV", env);
    const csp = await header("content-security-policy");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(await header("x-frame-options")).toBe("DENY");
    expect(await header("x-content-type-options")).toBe("nosniff");
    expect(await header("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(await header("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("leave form-action open, since the newsletter form posts to Buttondown", async () => {
    expect(await header("content-security-policy")).not.toContain("form-action");
  });
});

describe("X-Robots-Tag", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is not sent on production, so the site stays indexable", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await robotsHeader()).toBeUndefined();
  });

  it("tells crawlers not to index preview deployments (dev/stage)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await robotsHeader()).toBe("noindex");
  });
});

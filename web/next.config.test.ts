import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "./next.config.mjs";

const robotsHeader = async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  return rules
    .flatMap((rule) => rule.headers)
    .find((h) => h.key.toLowerCase() === "x-robots-tag")?.value;
};

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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({ getObjectBytes: vi.fn(), objectExists: vi.fn() }));
// unstable_cache memoises across calls, which would make these assertions
// depend on test order. The identity wrapper keeps the cache-key contract
// (asserted separately below) without the memoisation.
const cacheCall = vi.hoisted(() => ({
  keys: undefined as unknown,
  options: undefined as unknown,
  fn: undefined as undefined | (() => Promise<unknown>),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keys: unknown, options: unknown) => {
    cacheCall.keys = keys;
    cacheCall.options = options;
    cacheCall.fn = fn;
    return fn;
  },
}));

import { getPublishedResume, RESUME_CACHE_TAG } from "./resume-content";
import { getObjectBytes, objectExists } from "@/lib/aws";
import { placeholderResume } from "@/content/resume";

const PUBLISHED = {
  headline: { name: "Real Name", title: "Real Title", summary: "Real summary." },
  work: [
    { role: "R", org: "O", start: "2025", end: "Present", bullets: ["shipped a thing"] },
  ],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

describe("getPublishedResume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
    // Spied rather than left alone: the failure paths below assert it fired,
    // and an unspied console.error dumps stack traces into the test output.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the published resume when one exists", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(PUBLISHED)));

    const { resume, published } = await getPublishedResume();

    expect(published).toBe(true);
    expect(resume).toEqual(PUBLISHED);
  });

  it("falls back to the placeholder before the first publish", async () => {
    // This is the state of production on the day this ships, not a
    // theoretical edge case.
    vi.mocked(objectExists).mockResolvedValue(false);

    const { resume, published, invalid } = await getPublishedResume();

    expect(published).toBe(false);
    expect(resume).toEqual(placeholderResume);
    expect(getObjectBytes).not.toHaveBeenCalled();
    // The half of the discriminator that matters: nothing published is not an
    // integrity failure, so it must stay distinguishable from one.
    expect(invalid).toBeUndefined();
  });

  it("falls back rather than throwing when the stored JSON is corrupt", async () => {
    // A broken object must not take the whole portfolio down.
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from("not json"));

    const { resume, published } = await getPublishedResume();

    expect(published).toBe(false);
    expect(resume).toEqual(placeholderResume);
  });

  it("falls back when the stored JSON does not match the schema", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(
      Buffer.from(JSON.stringify({ headline: { name: "only" } })),
    );

    const { published, invalid } = await getPublishedResume();
    expect(published).toBe(false);
    expect(invalid).toBe(true);
  });

  it("falls back when the bucket is not configured at all", async () => {
    // The state during a local build and in CI: RESUME_BUCKET_NAME is unset,
    // so objectExists rejects with a serializer/credentials error rather than
    // returning false. If this is not caught, /resume and /about fail the
    // build on the exact path the fallback exists to cover.
    delete process.env.RESUME_BUCKET_NAME;
    vi.mocked(objectExists).mockRejectedValue(new Error("Bucket is required"));

    const { resume, published } = await getPublishedResume();

    expect(published).toBe(false);
    expect(resume).toEqual(placeholderResume);
    // Short-circuits before the probe, so this ordinary state stays out of
    // both S3 and the logs.
    expect(objectExists).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("lets a read failure escape the cached function rather than caching it", async () => {
    // unstable_cache does not persist a rejected promise. Catching inside it
    // would store the placeholder and serve it for the rest of the TTL; letting
    // the error out means no entry is written and the next request retries.
    vi.mocked(objectExists).mockRejectedValue(new Error("ExpiredToken"));

    await expect(cacheCall.fn!()).rejects.toThrow("ExpiredToken");
  });

  it("logs when a configured bucket fails to read", async () => {
    // Expired credentials, an IAM change or an S3 outage must not look the
    // same in the logs as the nothing-published-yet state.
    vi.mocked(objectExists).mockRejectedValue(new Error("ExpiredToken"));

    const { published } = await getPublishedResume();

    expect(published).toBe(false);
    expect(console.error).toHaveBeenCalledOnce();
    expect(vi.mocked(console.error).mock.calls[0][0]).toMatch(/falling back to placeholder/);
  });

  it("logs when the published JSON fails validation", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(
      Buffer.from(JSON.stringify({ headline: { name: "only" } })),
    );

    await getPublishedResume();

    expect(vi.mocked(console.error).mock.calls[0][0]).toMatch(/failed validation/);
  });

  it("hides the PDF link when a publish landed the JSON but not the PDF", async () => {
    // publish copies current.json and current.pdf in two separate calls, so a
    // failure between them leaves exactly this state. Rendering a Download
    // link against it points the visitor at a 404.
    vi.mocked(objectExists).mockImplementation(
      async (_bucket: string, key: string) => key === "resume/current.json",
    );
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(PUBLISHED)));

    const { published, pdfPublished, resume } = await getPublishedResume();

    expect(published).toBe(true);
    expect(pdfPublished).toBe(false);
    expect(resume).toEqual(PUBLISHED);
  });

  it("keeps the published resume when the PDF probe itself fails", async () => {
    // A HEAD failure on the PDF must not drop a timeline we already read.
    vi.mocked(objectExists).mockImplementation(async (_bucket: string, key: string) => {
      if (key === "resume/current.json") return true;
      throw new Error("ExpiredToken");
    });
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(PUBLISHED)));

    const { published, pdfPublished, resume } = await getPublishedResume();

    expect(published).toBe(true);
    expect(pdfPublished).toBe(false);
    expect(resume).toEqual(PUBLISHED);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("reads from the resume bucket, not the audio bucket", async () => {
    vi.mocked(objectExists).mockResolvedValue(true);
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(PUBLISHED)));
    process.env.S3_BUCKET_NAME = "audio-bucket";

    await getPublishedResume();

    expect(vi.mocked(getObjectBytes).mock.calls[0][0]).toBe("resume-bucket");
    expect(vi.mocked(getObjectBytes).mock.calls[0][1]).toBe("resume/current.json");
  });

  it("uses the tag the publish route revalidates", () => {
    // Phase 2's publish route calls revalidateTag("resume"). If these two
    // strings drift, publishing silently stops updating the public pages.
    // Asserting the constant alone would not catch that: the options literal
    // is what the cache actually receives, so pin it too.
    expect(RESUME_CACHE_TAG).toBe("resume");
    expect(cacheCall.keys).toEqual(["resume-current"]);
    expect(cacheCall.options).toEqual({ tags: ["resume"], revalidate: 60 });
  });
});

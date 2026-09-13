import { unstable_cache } from "next/cache";
import { getObjectBytes, objectExists } from "./aws";
import { CURRENT_JSON_KEY, CURRENT_PDF_KEY, resumeBucket } from "./resume-keys";
import { resumeSchema, type Resume } from "./resume-schema";
import { placeholderResume } from "../content/resume";

// Phase 2's publish route calls revalidateTag("resume"). Both sides must agree
// on this string or publishing stops updating the public pages.
export const RESUME_CACHE_TAG = "resume";

export type PublishedResume = {
  resume: Resume;
  published: boolean;
  // Tracked separately from `published`: publish copies current.json and
  // current.pdf in two calls, so a half-finished publish leaves the JSON
  // present and the PDF absent. /resume.pdf answers on the PDF alone, so the
  // Download link has to as well or it points at a 404.
  pdfPublished: boolean;
};

// unstable_cache rather than the "use cache" directive: cacheComponents is off
// in next.config.mjs, so the directive is unavailable, and enabling it is a
// repo-wide rendering change well beyond this feature. See the design spec §8.
// Separate from the JSON read, and separately caught: a HEAD failure on the
// PDF must not cost us a timeline we already read successfully. The link hides,
// the page still renders.
async function publishedPdfExists(bucket: string): Promise<boolean> {
  try {
    return await objectExists(bucket, CURRENT_PDF_KEY);
  } catch (err) {
    console.error("resume-content: could not check for the published PDF", err);
    return false;
  }
}

const readCurrent = unstable_cache(
  async (): Promise<PublishedResume> => {
    // EVERYTHING is inside the try, including the existence probe. With
    // RESUME_BUCKET_NAME unset — which is the case during a local build and in
    // CI — resumeBucket() returns undefined and objectExists rejects with a
    // serializer or credentials error, not a NotFound. Probing outside the try
    // would let that propagate and fail the build on the very path this
    // fallback exists to cover.
    // Reading the env var cannot throw, so this is not the probe the comment
    // above rules out — it just separates "no bucket configured here", which
    // is the normal state of CI and of a local build, from a genuine read
    // failure. Without it every such request would log an error.
    if (!process.env.RESUME_BUCKET_NAME) {
      return { resume: placeholderResume, published: false, pdfPublished: false };
    }

    try {
      const bucket = resumeBucket();

      if (!(await objectExists(bucket, CURRENT_JSON_KEY))) {
        return { resume: placeholderResume, published: false, pdfPublished: false };
      }

      const bytes = await getObjectBytes(bucket, CURRENT_JSON_KEY);
      const parsed = resumeSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      if (!parsed.success) {
        console.error("resume-content: published JSON failed validation", parsed.error);
        return { resume: placeholderResume, published: false, pdfPublished: false };
      }
      return {
        resume: parsed.data,
        published: true,
        pdfPublished: await publishedPdfExists(bucket),
      };
    } catch (err) {
      // A corrupt object or missing credentials still falls back rather than
      // throwing: the resume is one section of a portfolio, and a bad read
      // must not take the whole page down. It is logged, though — otherwise
      // an expired credential or an IAM change is indistinguishable in the
      // logs from the legitimate nothing-published-yet state, and the only
      // symptom is a human noticing placeholder copy in production.
      console.error("resume-content: falling back to placeholder", err);
      return { resume: placeholderResume, published: false, pdfPublished: false };
    }
  },
  ["resume-current"],
  // The tag is the fast path: publishing revalidates it and the page updates
  // without a redeploy. The TTL is the floor under a failed read — without it
  // a single transient S3 error caches the placeholder until the next publish,
  // which may be days away, with no way to recover but to publish again.
  { tags: [RESUME_CACHE_TAG], revalidate: 60 },
);

export async function getPublishedResume(): Promise<PublishedResume> {
  return readCurrent();
}

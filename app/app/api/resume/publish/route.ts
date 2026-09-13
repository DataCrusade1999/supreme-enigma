import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { copyObject, objectExists } from "@/lib/aws";
import {
  CURRENT_JSON_KEY,
  CURRENT_PDF_KEY,
  archiveKeys,
  draftJsonKey,
  draftPdfKey,
  resumeBucket,
} from "@/lib/resume-keys";

export async function POST(request: Request) {
  // Application-level rather than IAM-level: all branches share one IAM user,
  // so the credentials retain the S3 permission everywhere. A second,
  // production-only key pair was considered and rejected as more machinery
  // than a single-user site behind a password gate justifies. See spec §7.3.
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { error: "publishing is only available on production" },
      { status: 403 },
    );
  }

  const { draftId } = await request.json();

  let pdfKey: string;
  let jsonKey: string;
  try {
    pdfKey = draftPdfKey(draftId);
    jsonKey = draftJsonKey(draftId);
  } catch {
    return NextResponse.json({ error: "invalid draft id" }, { status: 400 });
  }

  const bucket = resumeBucket();

  // Both halves must be there before anything is overwritten. `resume/drafts/`
  // expires after a day and the two objects are not deleted atomically, so a
  // day-old draft can still have its PDF while its JSON is already gone — and a
  // draft whose extraction 502'd never had a JSON at all. Without this check the
  // first copy lands and the second throws, leaving current.pdf and current.json
  // describing different resumes.
  if (!(await objectExists(bucket, pdfKey)) || !(await objectExists(bucket, jsonKey))) {
    return NextResponse.json(
      { error: "that draft is incomplete or has expired" },
      { status: 404 },
    );
  }

  // Archive before promoting. The reverse order would overwrite the live pair
  // before it had been copied anywhere.
  //
  // Each half is checked on its own because the live pair can genuinely be
  // asymmetric: the very first publish promotes current.json and can then fail
  // on current.pdf, so the retry it asks for below finds a live JSON with no
  // PDF beside it. Keying the whole step off current.json alone would copy a
  // CURRENT_PDF_KEY that is not there and throw NoSuchKey out of the route;
  // keying it off nothing would let a lone current.pdf be overwritten with no
  // copy kept anywhere.
  const liveJson = await objectExists(bucket, CURRENT_JSON_KEY);
  const livePdf = await objectExists(bucket, CURRENT_PDF_KEY);
  const archived = liveJson || livePdf;
  if (archived) {
    const target = archiveKeys();
    try {
      if (livePdf) await copyObject(bucket, CURRENT_PDF_KEY, target.pdf);
      if (liveJson) await copyObject(bucket, CURRENT_JSON_KEY, target.json);
    } catch {
      // Nothing has been overwritten yet at this point, so refusing here keeps
      // the live resume intact rather than replacing it with no copy kept.
      return NextResponse.json(
        { error: "could not archive the live resume — nothing was overwritten" },
        { status: 500 },
      );
    }
  }

  // JSON first: it is what the public page renders. If the second copy fails the
  // site shows the new resume with a stale download, which beats the reverse.
  //
  // Two copies, not one transaction. A rollback here would be another copy that
  // can fail the same way, and on a first publish there is no archived pair to
  // restore from — so this reports the half-finished state instead. Retrying the
  // same draft re-runs both copies and repairs it.
  try {
    await copyObject(bucket, jsonKey, CURRENT_JSON_KEY);
    await copyObject(bucket, pdfKey, CURRENT_PDF_KEY);
  } catch {
    return NextResponse.json(
      { error: "the publish landed only partway — publish the same draft again" },
      { status: 500 },
    );
  }

  // Deliberately not reached on the partial path above: leaving the tag alone
  // keeps the public page serving the old pair from cache, which is at least
  // self-consistent, until a retry lands both halves.
  //
  // Both copies have landed by here, so the publish is done and saying
  // otherwise would be wrong. A 500 would send the operator into a retry that
  // re-archives the pair it just promoted, for a cache that any later request
  // re-primes anyway.
  try {
    revalidateTag("resume", { expire: 0 });
  } catch {
    // Swallowed on purpose — see above.
  }
  return NextResponse.json({ ok: true, archived });
}

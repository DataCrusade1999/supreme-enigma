"use client";
import { useState } from "react";
import Link from "next/link";
import { CommandBar } from "../../../components/site/CommandBar";
import { resumeSchema } from "../../../lib/resume-schema";

type Status = "idle" | "uploading" | "extracting" | "review" | "publishing" | "done" | "error";

export default function ResumeAdminPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // Validated as you type against the same schema the server enforces, so a
  // typo is caught before Publish rather than by a 422.
  function onJsonChange(next: string) {
    setJson(next);
    try {
      const parsed = resumeSchema.safeParse(JSON.parse(next));
      setSchemaError(parsed.success ? null : parsed.error.issues[0].message);
    } catch {
      setSchemaError("Not valid JSON");
    }
  }

  async function handleFile(file: File) {
    setError(null);
    // Cleared before the presign rather than after it. `draftId` advances to the
    // new draft the moment the presign returns, so anything still in the editor
    // belongs to a draft the operator has moved on from — and a settled failure
    // after that point (a 502 from extract, say) re-enables the buttons with the
    // previous draft's JSON under the new draft's id. Choosing a new file is an
    // explicit abandon of the old one, so dropping its edits is the intent.
    setJson("");
    setSchemaError(null);
    setDraftId(null);
    try {
      setStatus("uploading");
      const urlRes = await fetch("/api/resume/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      if (!urlRes.ok) {
        const { error: message } = await urlRes.json().catch(() => ({ error: null }));
        throw new Error(
          urlRes.status === 413
            ? "That PDF is over the 5 MB limit."
            : (message ?? "Could not start the upload."),
        );
      }
      const { draftId: id, uploadUrl } = await urlRes.json();
      // Recorded as soon as it exists, not after extraction succeeds. The PDF
      // is in S3 from the PUT below onward; losing its id would mean
      // re-uploading and paying for another extraction just to retry.
      setDraftId(id);

      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error("The upload was rejected by storage.");

      setStatus("extracting");
      const extractRes = await fetch("/api/resume/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id }),
      });
      const extracted = await extractRes.json();

      if (!extractRes.ok) {
        // A 422 means the model replied but the result failed the schema. The
        // route returns what it actually got as `raw`; putting that in the
        // editor lets the owner fix it by hand instead of re-extracting.
        if (extractRes.status === 422 && extracted.raw) {
          setJson(JSON.stringify(extracted.raw, null, 2));
          onJsonChange(JSON.stringify(extracted.raw, null, 2));
          setError("The extraction did not match the schema — correct it below.");
          setStatus("review");
          return;
        }
        throw new Error(extracted.error ?? "Extraction failed.");
      }

      setJson(JSON.stringify(extracted.resume, null, 2));
      setSchemaError(null);
      setStatus("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  // Returns whether the save landed. Publish depends on this answer: if the
  // draft PUT fails and publish runs anyway, the publish route promotes
  // whatever JSON is already in S3 — the pre-correction extraction — while the
  // UI reports success, silently discarding the owner's edits.
  async function save(): Promise<boolean> {
    // `busy` disables both buttons while this runs, so a throw escaping here
    // would leave them disabled and the status stuck on the in-flight text with
    // no way back but a reload — the same wedge the empty-editor guard above
    // exists to prevent. handleFile already wraps its fetches for this reason.
    let res: Response;
    try {
      res = await fetch("/api/resume/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, resume: JSON.parse(json) }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error while saving.");
      setStatus("error");
      return false;
    }
    if (!res.ok) {
      setError("The server rejected those corrections.");
      setStatus("error");
      return false;
    }
    return true;
  }

  async function publish() {
    setStatus("publishing");
    // Stop here on a failed save — save() has already set the error state.
    if (!(await save())) return;

    let res: Response;
    try {
      res = await fetch("/api/resume/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error while publishing.");
      setStatus("error");
      return;
    }
    if (!res.ok) {
      const { error: message } = await res.json().catch(() => ({ error: null }));
      setError(
        res.status === 403
          ? "Publishing only works on the production deployment. Open this page there with the same draft."
          : (message ?? "Publishing failed."),
      );
      setStatus("error");
      return;
    }
    setStatus("done");
  }

  // Anything in flight that makes the draftId and the editor's contents
  // disagree, or that a second write would race. Deliberately not "error":
  // a failed publish is retried from this same page with the same draft, and
  // the publish route's half-finished path explicitly asks for that retry.
  // Staleness after a failed upload is handled at the source, in handleFile.
  const busy = status === "uploading" || status === "extracting" || status === "publishing";

  return (
    <div className="flex min-h-screen flex-col font-ui">
      <header className="flex items-center justify-between border-b-2 border-rule-heavy px-5 py-5 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg"
        >
          <span aria-hidden="true" className="block h-3.5 w-1 shrink-0 bg-accent" />
          Ashutosh Pandey
        </Link>
        <span className="text-[0.6875rem] uppercase tracking-[0.16em] text-muted">
          Tools / Resume admin
        </span>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-6 px-5 py-14 sm:px-10">
        <div className="col-span-12 lg:col-span-5">
          <h1 className="font-display text-3xl leading-[1.15]">Publish a resume</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Upload a PDF, check what was read out of it, then publish. The PDF and
            the extracted JSON both go live; the previous pair is archived.
          </p>

          <label className="mt-8 block">
            <span className="sr-only">Resume PDF</span>
            <input
              type="file"
              accept="application/pdf"
              disabled={status === "uploading" || status === "extracting"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="block w-full text-sm text-muted file:mr-4 file:border-0 file:bg-fg file:px-3 file:py-2 file:text-[0.6875rem] file:font-semibold file:uppercase file:tracking-[0.16em] file:text-bg"
            />
          </label>

          <p className="mt-6 text-xs uppercase tracking-[0.14em] text-muted">
            {status === "idle" && "Waiting for a file"}
            {status === "uploading" && "Uploading…"}
            {status === "extracting" && "Reading the PDF…"}
            {status === "review" &&
              (error ? (
                // A 422 lands here: the editor is usable and prefilled with
                // what the model actually returned, so this is a warning
                // rather than a dead end.
                <span className="text-peak">{error}</span>
              ) : (
                "Check the extraction"
              ))}
            {status === "publishing" && "Publishing…"}
            {status === "done" && <span className="text-accent">Published</span>}
            {status === "error" && <span className="text-peak">{error}</span>}
          </p>
        </div>

        {status !== "idle" && draftId && (
          <div className="col-span-12 lg:col-span-7">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs uppercase tracking-[0.14em] text-muted">
                Extracted content
              </h2>
              <Link
                href={`/tools/resume-admin/preview/${draftId}`}
                className="text-xs uppercase tracking-[0.14em] text-accent underline"
              >
                Preview →
              </Link>
            </div>

            <textarea
              value={json}
              onChange={(e) => onJsonChange(e.target.value)}
              spellCheck={false}
              rows={24}
              className="mt-4 w-full border border-line bg-transparent p-4 font-mono text-xs leading-relaxed"
            />

            {schemaError && <p className="mt-2 text-xs text-peak">{schemaError}</p>}

            <div className="mt-4 flex gap-3">
              {/* draftId is set as soon as the presign returns, so this panel also
                  renders after a failed upload or extraction — with an empty
                  editor and no schemaError yet. Gating on the editor's contents
                  too keeps both actions off until there is something to act on;
                  without it, save() reaches JSON.parse("") inside an async
                  onClick and the page sticks on "Publishing…" forever.

                  `busy` covers the other half: uploading a second PDF sets
                  draftId to the new draft immediately, while the editor still
                  holds the previous one's JSON until extraction returns. Acting
                  in that window would write the old content under the new id. */}
              <button
                type="button"
                onClick={save}
                disabled={Boolean(schemaError) || json.trim().length === 0 || busy}
                className="min-h-11 border border-line px-4 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] disabled:opacity-40"
              >
                Save draft
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={Boolean(schemaError) || json.trim().length === 0 || busy}
                className="min-h-11 bg-fg px-4 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-bg disabled:opacity-40"
              >
                Publish
              </button>
            </div>
          </div>
        )}
      </main>

      <CommandBar />
    </div>
  );
}

"use client";
import { useState } from "react";

type Status = "idle" | "uploading" | "processing" | "done" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    setDownloadUrl(null);

    try {
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      const { key, uploadUrl } = await urlRes.json();

      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      setStatus("processing");
      const processRes = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!processRes.ok) throw new Error("Processing failed");
      const { downloadUrl: url } = await processRes.json();

      setDownloadUrl(url);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <main>
      <label>
        Choose a BGM file
        <input
          type="file"
          accept="audio/*"
          disabled={status === "uploading" || status === "processing"}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      {status === "uploading" && <p>Uploading…</p>}
      {status === "processing" && <p>Processing…</p>}
      {status === "error" && <p role="alert">{error}</p>}
      {status === "done" && downloadUrl && (
        <div>
          <audio controls loop src={downloadUrl} />
          <a href={downloadUrl} download>
            Download
          </a>
        </div>
      )}
    </main>
  );
}

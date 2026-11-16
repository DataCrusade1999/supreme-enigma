import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/aws")>()),
  presignUpload: vi.fn(async () => "https://example.test/upload"),
}));

import { POST } from "./route";
import { presignUpload } from "@/lib/aws";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/looper/upload-url", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/looper/upload-url", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs an audio upload under uploads/ with a lowercased extension", async () => {
    const res = await post({ filename: "Song.MP3", contentType: "audio/mpeg", size: 1000 });

    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key).toMatch(/^uploads\/[0-9a-f-]{36}\.mp3$/);
    expect(presignUpload).toHaveBeenCalledWith(key, "audio/mpeg", 1000);
  });

  it("accepts an audio extension with no type, as browsers send for FLAC on Windows", async () => {
    const res = await post({ filename: "take.flac", contentType: "", size: 1000 });

    expect(res.status).toBe(200);
    expect(presignUpload).toHaveBeenCalledWith(expect.stringMatching(/\.flac$/), "", 1000);
  });

  it.each([
    { filename: "notes.txt", contentType: "audio/mpeg" },
    { filename: "notes.txt", contentType: "" },
    { filename: "song", contentType: "audio/mpeg" },
    { filename: "song.mp3", contentType: "text/html" },
    { filename: "song.mp3", contentType: undefined },
  ])("refuses $filename as $contentType", async (body) => {
    const res = await post({ ...body, size: 1000 });

    expect(res.status).toBe(400);
    expect(presignUpload).not.toHaveBeenCalled();
  });
});

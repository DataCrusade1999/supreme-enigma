import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  putObjectJson: vi.fn(),
  getObjectBytes: vi.fn(),
}));

import { PUT, GET } from "./route";
import { putObjectJson, getObjectBytes } from "@/lib/aws";

const VALID = {
  headline: { name: "A", title: "B", summary: "C" },
  work: [{ role: "R", org: "O", start: "2025", end: "Present", bullets: ["did a thing"] }],
  skills: [{ group: "Languages", items: ["TypeScript"] }],
};

describe("/api/resume/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESUME_BUCKET_NAME = "resume-bucket";
  });

  it("saves a valid corrected draft", async () => {
    const res = await PUT(
      new Request("http://localhost/api/resume/draft", {
        method: "PUT",
        body: JSON.stringify({ draftId: "abc", resume: VALID }),
      }),
    );

    expect(res.status).toBe(200);
    const [bucket, key, body] = vi.mocked(putObjectJson).mock.calls[0];
    expect(bucket).toBe("resume-bucket");
    expect(key).toBe("resume/drafts/abc/resume.json");
    expect(body).toEqual(VALID);
  });

  it("re-validates server-side and refuses an invalid edit", async () => {
    // The client validates as you type, but the client is not the authority —
    // a hand-crafted request must not be able to write malformed JSON.
    const res = await PUT(
      new Request("http://localhost/api/resume/draft", {
        method: "PUT",
        body: JSON.stringify({ draftId: "abc", resume: { headline: {} } }),
      }),
    );

    expect(res.status).toBe(422);
    expect(putObjectJson).not.toHaveBeenCalled();
  });

  it("reads a draft back", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from(JSON.stringify(VALID)));
    const res = await GET(
      new Request("http://localhost/api/resume/draft?draftId=abc"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resume: VALID });
  });

  it("returns 404 for a draft that has expired rather than a bare 500", async () => {
    // `resume/drafts/` expires after a day, and the admin page can be
    // bookmarked, so a well-formed id whose object is gone is a normal request.
    vi.mocked(getObjectBytes).mockRejectedValue(
      Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }),
    );

    const res = await GET(
      new Request("http://localhost/api/resume/draft?draftId=abc"),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no draft for that id" });
  });

  it("returns 422 when the stored draft is not valid JSON", async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from("not json"));

    const res = await GET(
      new Request("http://localhost/api/resume/draft?draftId=abc"),
    );

    expect(res.status).toBe(422);
  });

  it("rejects an unsafe draft id on both verbs", async () => {
    const put = await PUT(
      new Request("http://localhost/api/resume/draft", {
        method: "PUT",
        body: JSON.stringify({ draftId: "../current", resume: VALID }),
      }),
    );
    expect(put.status).toBe(400);

    const get = await GET(
      new Request("http://localhost/api/resume/draft?draftId=../current"),
    );
    expect(get.status).toBe(400);
  });
});

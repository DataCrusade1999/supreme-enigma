import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mockRead = vi.fn();
const mockIsIssueSent = vi.fn();
const mockSendIssue = vi.fn();

vi.mock("../../../../lib/keystatic-reader", () => ({
  getReader: () => ({
    collections: { newsletter: { read: mockRead } },
  }),
}));

vi.mock("../../../../lib/buttondown", () => ({
  isIssueSent: (...args: unknown[]) => mockIsIssueSent(...args),
  sendIssue: (...args: unknown[]) => mockSendIssue(...args),
}));

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/newsletter/send", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string) {
  return new Request("http://localhost/api/newsletter/send", {
    method: "POST",
    body,
  });
}

describe("POST /api/newsletter/send", () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockIsIssueSent.mockReset();
    mockSendIssue.mockReset();
  });

  it("returns 400 when slug is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the issue doesn't exist", async () => {
    mockRead.mockResolvedValue(null);
    const res = await POST(makeRequest({ slug: "missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 409 and does not call sendIssue when already sent", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockResolvedValue(true);
    const res = await POST(makeRequest({ slug: "issue-one" }));
    expect(res.status).toBe(409);
    expect(mockSendIssue).not.toHaveBeenCalled();
  });

  it("sends and returns 200 on the happy path", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockResolvedValue(false);
    mockSendIssue.mockResolvedValue(undefined);
    const res = await POST(makeRequest({ slug: "issue-one" }));
    expect(res.status).toBe(200);
    expect(mockSendIssue).toHaveBeenCalledWith({
      slug: "issue-one",
      subject: "Issue One",
      body: "body text",
    });
  });

  it("returns 400 rather than 500 when the body is not valid JSON", async () => {
    const res = await POST(makeRawRequest("not-json"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("returns a structured 502 when the status check itself fails", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockRejectedValue(new Error("Buttondown list emails failed: 503 down"));
    const res = await POST(makeRequest({ slug: "issue-one" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("Status check failed");
    expect(mockSendIssue).not.toHaveBeenCalled();
  });

  it("does not dispatch twice when two sends for the same slug race", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockResolvedValue(false);

    // Hold the first send open until the second has been answered, so the two
    // genuinely overlap rather than running back to back.
    let release: () => void = () => {};
    let signalEntered: () => void = () => {};
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    mockSendIssue.mockImplementation(() => {
      signalEntered();
      return new Promise<void>((resolve) => { release = resolve; });
    });

    const first = POST(makeRequest({ slug: "issue-one" }));
    await entered;
    const second = await POST(makeRequest({ slug: "issue-one" }));

    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(mockSendIssue).toHaveBeenCalledTimes(1);
  });

  it("lets a later send proceed once the in-flight one has settled", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockResolvedValue(false);
    mockSendIssue.mockResolvedValue(undefined);

    expect((await POST(makeRequest({ slug: "issue-one" }))).status).toBe(200);
    expect((await POST(makeRequest({ slug: "issue-one" }))).status).toBe(200);
    expect(mockSendIssue).toHaveBeenCalledTimes(2);
  });

  it("returns 502 with the error message when sendIssue throws", async () => {
    mockRead.mockResolvedValue({
      title: "Issue One",
      content: async () => "body text",
    });
    mockIsIssueSent.mockResolvedValue(false);
    mockSendIssue.mockRejectedValue(new Error("Buttondown send failed: 500 oops"));
    const res = await POST(makeRequest({ slug: "issue-one" }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("Buttondown send failed");
  });
});

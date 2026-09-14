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

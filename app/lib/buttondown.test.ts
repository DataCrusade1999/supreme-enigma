import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isIssueSent, sendIssue } from "./buttondown";

describe("buttondown", () => {
  beforeEach(() => {
    vi.stubEnv("BUTTONDOWN_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("isIssueSent", () => {
    it("returns true when an email with a matching slug exists", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            results: [{ id: "1", slug: "issue-one", subject: "Issue One", status: "sent" }],
            next: null,
          }),
        }),
      );
      await expect(isIssueSent("issue-one")).resolves.toBe(true);
    });

    it("returns false when no email matches, following pagination", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [{ id: "1", slug: "other-issue", subject: "Other", status: "sent" }],
            next: "https://api.buttondown.com/v1/emails?page=2",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [], next: null }),
        });
      vi.stubGlobal("fetch", fetchMock);
      await expect(isIssueSent("issue-one")).resolves.toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws when the list request fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }),
      );
      await expect(isIssueSent("issue-one")).rejects.toThrow();
    });
  });

  describe("sendIssue", () => {
    it("posts the expected request shape and headers", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 201,
        json: async () => ({ id: "1" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      await sendIssue({ slug: "issue-one", subject: "Issue One", body: "Hello" });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.buttondown.com/v1/emails",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            subject: "Issue One",
            slug: "issue-one",
            body: "Hello",
            status: "about_to_send",
          }),
        }),
      );
      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers).toMatchObject({
        Authorization: "Token test-key",
        "X-API-Version": "2026-04-01",
        "X-Buttondown-Live-Dangerously": "true",
      });
    });

    it("throws when the response status is not 201", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ status: 409, text: async () => "conflict" }),
      );
      await expect(
        sendIssue({ slug: "issue-one", subject: "Issue One", body: "Hello" }),
      ).rejects.toThrow();
    });
  });

  it("throws when BUTTONDOWN_API_KEY is not set", async () => {
    vi.unstubAllEnvs();
    await expect(isIssueSent("issue-one")).rejects.toThrow("BUTTONDOWN_API_KEY");
  });
});

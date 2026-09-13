import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractResumeFromPdf } from "./openrouter";

const PDF = Buffer.from("%PDF-1.4 fake");

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("extractResumeFromPdf", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.example/api/v1";
    process.env.OPENROUTER_MODEL = "anthropic/claude-haiku-4.5";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed JSON content on success", async () => {
    const payload = { headline: { name: "A", title: "B", summary: "C" } };
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(200, { choices: [{ message: { content: JSON.stringify(payload) } }] }),
    );

    await expect(extractResumeFromPdf(PDF)).resolves.toEqual(payload);
  });

  it("sends the PDF as a base64 data URL with the file-parser plugin", async () => {
    const fetchMock = mockFetchOnce(200, {
      choices: [{ message: { content: "{}" } }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await extractResumeFromPdf(PDF);

    // The mock takes no declared parameters, so its recorded call tuple types as
    // `[]`; widen through `unknown` to read the arguments fetch was really given.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.example/api/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("anthropic/claude-haiku-4.5");
    expect(body.max_tokens).toBe(4000);
    expect(body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "native" } }]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    const file = body.messages[0].content.find((c: { type: string }) => c.type === "file");
    expect(file.file.file_data).toBe(`data:application/pdf;base64,${PDF.toString("base64")}`);
  });

  it("throws on a non-200 without leaking the key", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(402, { error: { message: "insufficient credit" } }));

    await expect(extractResumeFromPdf(PDF)).rejects.toThrow(/insufficient credit/);
    await expect(extractResumeFromPdf(PDF)).rejects.not.toThrow(/sk-or-test/);
  });

  it("reports the status when the error body is not JSON", async () => {
    // A 429 or 5xx from the edge in front of the API arrives as HTML. Parsing
    // before checking the status turned that into a SyntaxError, which the admin
    // page then showed instead of the real status.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html><title>429 Too Many Requests</title></html>", {
            status: 429,
          }),
      ),
    );

    await expect(extractResumeFromPdf(PDF)).rejects.toThrow(
      "OpenRouter request failed: status 429",
    );
  });

  it("throws when the response carries no content", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { choices: [] }));
    await expect(extractResumeFromPdf(PDF)).rejects.toThrow(/no content/i);
  });

  it("throws when the content is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(200, { choices: [{ message: { content: "I cannot help with that." } }] }),
    );
    await expect(extractResumeFromPdf(PDF)).rejects.toThrow(/not valid JSON/i);
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, MospiError } from "./mospi";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", "mospi", name), "utf8");

function sse(payload: unknown) {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}
function toolText(text: string) {
  return sse({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
}

describe("callTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a stateless tools/call and parses the single SSE event", async () => {
    const fetchMock = vi.fn(async () => new Response(fixture("cpi-general.sse.txt")));
    vi.stubGlobal("fetch", fetchMock);

    const result = (await callTool("get_data", { dataset: "CPI", filters: { limit: "100" } })) as {
      data: { month: string; inflation: string | null }[];
    };

    expect(result.data[0]).toMatchObject({ month: "August", inflation: "4.82" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mcp.mospi.gov.in/");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json, text/event-stream");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "get_data", arguments: { dataset: "CPI", filters: { limit: "100" } } },
    });
  });

  it("throws on MoSPI's upstream-400 body, which has an error key but no valid key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(fixture("error-limit.sse.txt"))));
    await expect(callTool("get_data", {})).rejects.toThrow(/MoSPI rejected the query: An error occurred: 400/);
  });

  it("throws on MoSPI's invalid-filter body", async () => {
    const body = JSON.stringify({ error: "Invalid parameters", valid: false, missing_required: ["series"] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(toolText(body))));
    await expect(callTool("get_data", {})).rejects.toThrow("MoSPI rejected the query: Invalid parameters");
  });

  it("throws on a JSON-RPC error", async () => {
    const body = sse({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Unknown tool" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(callTool("nope", {})).rejects.toThrow("MoSPI error: Unknown tool");
  });

  it("throws when the tool reports isError", async () => {
    const body = sse({
      jsonrpc: "2.0",
      id: 1,
      result: { isError: true, content: [{ type: "text", text: "dataset is required" }] },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(callTool("get_data", {})).rejects.toThrow("MoSPI tool error: dataset is required");
  });

  it("throws on a non-2xx status without reading the body as JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    await expect(callTool("get_data", {})).rejects.toThrow("MoSPI status 502");
  });

  it("throws a MospiError when the content is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(toolText("Service temporarily unavailable"))));
    await expect(callTool("get_data", {})).rejects.toBeInstanceOf(MospiError);
  });

  it("joins an event's data lines, as SSE allows one event to span several", async () => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: JSON.stringify({ data: [{ year: 2026 }] }) }] },
    });
    const half = payload.indexOf(',"result"');
    const body = `event: message\ndata: ${payload.slice(0, half)}\ndata: ${payload.slice(half)}\n\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    expect(await callTool("get_data", {})).toEqual({ data: [{ year: 2026 }] });
  });

  it("gives up after 10 s with a readable error", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
          ),
      ),
    );
    const call = callTool("get_data", {});
    controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await expect(call).rejects.toThrow("MoSPI did not answer within 10 s");
    await expect(call).rejects.toBeInstanceOf(MospiError);
    expect(timeout).toHaveBeenCalledWith(10_000);
    timeout.mockRestore();
  });
});

// MoSPI's MCP server is stateless: a tools/call works without initialize and
// answers with one SSE event holding the JSON-RPC response. Hand-written rather
// than the MCP SDK; see spec D7 and §6.1.
const MOSPI_URL = "https://mcp.mospi.gov.in/";
const TIMEOUT_MS = 10_000;

export class MospiError extends Error {}

/** MoSPI could not be reached: an HTTP error status, a timeout or a network
 * failure. Unlike a rejected query, asking again differently will not help. */
export class MospiUnavailableError extends MospiError {}

let nextId = 1;

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(MOSPI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
  } catch (err) {
    if ((err as { name?: string }).name === "TimeoutError") {
      throw new MospiUnavailableError(`MoSPI did not answer within ${TIMEOUT_MS / 1000} s`);
    }
    throw new MospiUnavailableError(`MoSPI could not be reached: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new MospiUnavailableError(`MoSPI status ${res.status}`);

  const body = await res.text();
  // One event, whose data may span several data: lines (joined with newlines).
  // The event ends at the first blank line.
  const event = body.split(/\r?\n\r?\n/)[0];
  const data = event
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""));
  let rpc: {
    error?: { message?: string };
    result?: { isError?: boolean; content?: { text?: unknown }[] };
  };
  try {
    rpc = JSON.parse(data.length > 0 ? data.join("\n") : body);
  } catch {
    throw new MospiError("MoSPI response is not JSON-RPC");
  }
  if (rpc.error) throw new MospiError(`MoSPI error: ${rpc.error.message ?? "unknown"}`);

  const text = rpc.result?.content?.[0]?.text;
  if (typeof text !== "string") throw new MospiError("MoSPI response has no content");
  if (rpc.result?.isError) throw new MospiError(`MoSPI tool error: ${text.slice(0, 200)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MospiError(`MoSPI content is not JSON: ${text.slice(0, 100)}`);
  }
  // MoSPI reports a rejected query inside a successful response, in two shapes:
  // {"error", "valid": false} for invalid filters and {"error", "troubleshooting"}
  // when its upstream API returns 400. Both carry an error key.
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    throw new MospiError(`MoSPI rejected the query: ${String(parsed.error).slice(0, 200)}`);
  }
  return parsed;
}

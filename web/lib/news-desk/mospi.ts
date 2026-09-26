// MoSPI's MCP server is stateless: a tools/call works without initialize and
// answers with one SSE event holding the JSON-RPC response. Hand-written rather
// than the MCP SDK; see spec D7 and §6.1.
const MOSPI_URL = "https://mcp.mospi.gov.in/";
const TIMEOUT_MS = 10_000;

export class MospiError extends Error {}

let nextId = 1;

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(MOSPI_URL, {
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
  if (!res.ok) throw new MospiError(`MoSPI status ${res.status}`);

  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  let rpc: {
    error?: { message?: string };
    result?: { isError?: boolean; content?: { text?: unknown }[] };
  };
  try {
    rpc = JSON.parse(line ? line.slice(5) : body);
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

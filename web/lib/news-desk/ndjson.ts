/** Calls onEvent with each line of an NDJSON body as soon as the line is complete. */
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) onEvent(JSON.parse(rest));
}

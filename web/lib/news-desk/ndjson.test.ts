// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readNdjson } from "./ndjson";

function streamOf(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe("readNdjson", () => {
  it("emits each line once it is complete, even when split across chunks", async () => {
    const seen: unknown[] = [];
    await readNdjson(streamOf('{"a":1}\n{"b"', ':2}\n\n{"c":3}'), (e) => seen.push(e));
    expect(seen).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });
});

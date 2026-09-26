import { NextResponse } from "next/server";
import { z } from "zod";
import { ask, isAskConfigured } from "@/lib/news-desk/ask";

// A question's tool loop ends itself before 55 s; see lib/news-desk/ask.ts.
export const maxDuration = 60;

const bodySchema = z.object({ question: z.string().trim().min(1).max(500) });

export async function POST(req: Request) {
  if (!isAskConfigured()) {
    return NextResponse.json({ error: "assistant not configured" }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "question must be 1 to 500 characters" }, { status: 400 });
  }

  const events = ask(parsed.data.question);
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  // Pulled one event at a time, so each step reaches the browser as it happens.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(line(value));
      } catch (err) {
        console.error("news-desk: ask failed", err);
        controller.enqueue(line({ type: "error", message: "The assistant failed unexpectedly." }));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

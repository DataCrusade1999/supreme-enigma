import { NextResponse } from "next/server";
import { PinError, pinIndicator, pinInputSchema } from "@/lib/news-desk/pins";
import { isStorageConfigured } from "@/lib/news-desk/store";

export async function POST(req: Request) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }
  const parsed = pinInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid pin" }, { status: 400 });
  try {
    return NextResponse.json({ indicator: await pinIndicator(parsed.data) }, { status: 201 });
  } catch (err) {
    if (err instanceof PinError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("news-desk: pin failed", err);
    return NextResponse.json(
      { error: "could not read or write the pinned indicators; nothing changed" },
      { status: 500 },
    );
  }
}

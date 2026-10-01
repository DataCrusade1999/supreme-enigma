import { NextResponse } from "next/server";
import { PinError, unpinIndicator } from "@/lib/news-desk/pins";
import { isStorageConfigured } from "@/lib/news-desk/store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }
  const { id } = await params;
  try {
    await unpinIndicator(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PinError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("news-desk: unpin failed", err);
    return NextResponse.json(
      { error: "could not read or write the pinned indicators; nothing changed" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/news-desk/refresh";
import { isStorageConfigured } from "@/lib/news-desk/store";

// Thirteen feeds in parallel take about 2 s. Tagging runs in the same request,
// its calls in parallel with a 40 s cap each. MoSPI indicators run in the same
// request, alongside the feeds and tagging, 10 s per call.
// See the design spec §9.
export const maxDuration = 60;

export async function POST() {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  }
  try {
    return NextResponse.json(await runRefresh());
  } catch (err) {
    console.error("news-desk: refresh failed", err);
    return NextResponse.json({ error: "refresh failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { withStore } from "@/lib/vpn/api";

export function GET() {
  return withStore(async (store) => NextResponse.json(await store.read()));
}

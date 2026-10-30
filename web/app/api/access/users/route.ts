import { NextResponse } from "next/server";
import { listUsers } from "@/lib/access-admin";
import { respond } from "@/lib/access-api";

export const dynamic = "force-dynamic";

export async function GET() {
  return respond(async () => NextResponse.json({ users: await listUsers() }));
}

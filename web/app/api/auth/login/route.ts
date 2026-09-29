import { NextRequest } from "next/server";
import { safeNext } from "@/lib/cognito";
import { redirectToCognito } from "../redirect-to-cognito";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return redirectToCognito(request, safeNext(request.nextUrl.searchParams.get("next")));
}

import { NextRequest } from "next/server";
import { redirectToCognito } from "../redirect-to-cognito";

export const dynamic = "force-dynamic";

// Cognito only lets a user with a live managed-login session add a passkey, so
// the hub links here through /api/auth/login rather than directly. Without that
// session Cognito returns ?result=invalid_session, which the callback reports
// as not added.
export async function GET(request: NextRequest) {
  return redirectToCognito(request, "/tools", "/passkeys/add");
}

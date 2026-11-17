import { NextRequest } from "next/server";
import { safeNext } from "@/lib/cognito";
import { redirectToCognito } from "../redirect-to-cognito";

export const dynamic = "force-dynamic";

// Visitors go straight to Google (#546): the pool creates no self-service users,
// so an email code or passkey works only for the owner's native user. `?as=owner`,
// linked from nowhere public, opens Cognito's page with every option. It hides
// the native options rather than locking them: a hand-built authorize URL still
// shows them.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const owner = params.get("as") === "owner";
  // "Google" is the identity provider's name in infra/modules/auth/main.tf.
  return redirectToCognito(request, safeNext(params.get("next")), undefined, owner ? undefined : "Google");
}

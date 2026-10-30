import { createUsernameSignInHandler } from "@/lib/auth-username-server";
import { usernameLoginDependencies } from "@/lib/server/username-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Readiness contains no identity information and never creates an account. */
export async function GET() {
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
  };
  try {
    const dependencies = usernameLoginDependencies();
    if (!dependencies)
      return Response.json({ available: false }, { status: 503, headers });
    await dependencies.resolveUserId("readiness.check");
    return Response.json({ available: true }, { headers });
  } catch {
    return Response.json({ available: false }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  return createUsernameSignInHandler(usernameLoginDependencies())(request);
}

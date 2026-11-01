import { getRuntime } from "../../../../lib/api/runtime.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../lib/api/log.js";
import { toResponse } from "../../../../lib/api/errors.js";
import { getAuthSession } from "../../../../lib/auth.js";
import { AuthMeResponseSchema } from "../../../../lib/contracts/auth.js";
import { env } from "../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user's public profile, or null if signed out.
 * Does not throw 401; returns { user: null } gracefully.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/auth/me");
  const runtimeDeps = context.runtime || getRuntime();
  const { db } = runtimeDeps;

  try {
    const auth = await getAuthSession(request, db, env);

    let publicUser = null;
    if (auth?.user) {
      publicUser = {
        id: auth.user.id,
        name: auth.user.name,
        email: auth.user.email,
        avatarUrl: auth.user.avatarUrl || auth.user.avatar_url || null,
      };
    }

    const payload = AuthMeResponseSchema.parse({ user: publicUser });

    const headers = new Headers(noStoreHeaders());
    headers.set("Content-Type", "application/json");

    reqLogger.logResponse(200);
    return applySecurityHeaders(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers,
      })
    );
  } catch (err) {
    reqLogger.logError(err);
    return toResponse(err);
  }
}

import { getRuntime } from "../../../lib/api/runtime.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../lib/api/headers.js";
import { createRequestLogger } from "../../../lib/api/log.js";
import { toResponse, apiError } from "../../../lib/api/errors.js";
import {
  getAuthSession,
  validateSameOrigin,
  serializeClearCookie,
  SESSION_COOKIE_NAME,
  getSessionCookieOptions,
} from "../../../lib/auth.js";
import { deleteUser } from "../../../lib/db/index.js";
import { env } from "../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/me
 *
 * Deletes user account and associated personal data.
 * Checks associated with this user have user_id set to NULL and expire naturally after 24h.
 * Active sessions are cascaded.
 * Requires same-origin CSRF validation.
 */
export async function DELETE(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/me");
  const runtimeDeps = context.runtime || getRuntime();
  const { db } = runtimeDeps;

  try {
    // CSRF check
    if (!validateSameOrigin(request, env.CLIENT_URL)) {
      throw apiError("FORBIDDEN", "Cross-origin account deletion rejected", 403);
    }

    const auth = await getAuthSession(request, db, env);
    if (!auth?.user) {
      throw apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const userId = auth.user.id;
    deleteUser(userId, db);

    const headers = new Headers(noStoreHeaders());
    headers.set("Content-Type", "application/json");
    headers.append(
      "Set-Cookie",
      serializeClearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions())
    );

    reqLogger.logResponse(200);

    return applySecurityHeaders(
      new Response(JSON.stringify({ ok: true, deleted: true }), {
        status: 200,
        headers,
      })
    );
  } catch (err) {
    reqLogger.logError(err);
    return toResponse(err);
  }
}

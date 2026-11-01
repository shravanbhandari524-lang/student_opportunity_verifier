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
import { deleteSession } from "../../../lib/db/index.js";
import { env } from "../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /auth/logout
 *
 * Terminates user session.
 * Requires same-origin check to prevent CSRF.
 * Deletes session from database and clears session cookie.
 */
export async function POST(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/auth/logout");
  const runtimeDeps = context.runtime || getRuntime();
  const { db } = runtimeDeps;

  try {
    // CSRF check
    if (!validateSameOrigin(request, env.CLIENT_URL)) {
      throw apiError("FORBIDDEN", "Cross-origin logout request rejected", 403);
    }

    const auth = await getAuthSession(request, db, env);
    if (auth?.session?.id) {
      deleteSession(auth.session.id, db);
    }

    const headers = new Headers(noStoreHeaders());
    headers.set("Content-Type", "application/json");
    headers.append(
      "Set-Cookie",
      serializeClearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions())
    );

    const accept = request.headers.get("accept") || "";
    // If browser form submission, redirect to /
    if (accept.includes("text/html") && !accept.includes("application/json")) {
      headers.set("Location", "/");
      reqLogger.logResponse(302);
      return applySecurityHeaders(new Response(null, { status: 302, headers }));
    }

    reqLogger.logResponse(200);
    return applySecurityHeaders(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers,
      })
    );
  } catch (err) {
    reqLogger.logError(err);
    return toResponse(err);
  }
}

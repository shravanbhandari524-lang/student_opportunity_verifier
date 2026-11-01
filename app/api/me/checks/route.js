import { getRuntime } from "../../../../lib/api/runtime.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../lib/api/log.js";
import { toResponse, apiError } from "../../../../lib/api/errors.js";
import { getAuthSession } from "../../../../lib/auth.js";
import { getUserChecks } from "../../../../lib/db/index.js";
import { UserChecksResponseSchema } from "../../../../lib/contracts/auth.js";
import { env } from "../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/checks
 *
 * Returns non-expired checks associated with the authenticated user.
 * 401 if unauthenticated.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/me/checks");
  const runtimeDeps = context.runtime || getRuntime();
  const { db } = runtimeDeps;

  try {
    const auth = await getAuthSession(request, db, env);
    if (!auth?.user) {
      throw apiError("UNAUTHORIZED", "Authentication required to view checks", 401);
    }

    const checks = getUserChecks(auth.user.id, db);

    const payload = UserChecksResponseSchema.parse({ checks });

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

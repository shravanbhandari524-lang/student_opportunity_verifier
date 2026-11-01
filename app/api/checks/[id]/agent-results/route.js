import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck, getAgentResults } from "../../../../../lib/db/index.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/checks/:id/agent-results
 *
 * Retrieves the specialist agent findings, statuses, traces, and classifier outputs.
 * Returns 404 for unknown checks and 410 for expired checks.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/agent-results");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db } = runtimeDeps;

  try {
    // 1. Rate Limiting per IP
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    if (rateLimiters?.getCheck) {
      rateLimiters.getCheck.assertAllowed(clientKey);
    }

    // 2. Validate Check ID (UUID v4)
    const params = await context.params;
    const rawId = params?.id;
    const checkId = assertValidCheckId(rawId);
    reqLogger.setCheckId(checkId);

    // 3. Verify check existence and expiration
    const check = getCheck(checkId, db);
    if (!check) {
      throw apiError("NOT_FOUND", "Check not found", 404);
    }

    const nowIso = new Date().toISOString();
    if (check.expiresAt && check.expiresAt < nowIso) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    // 4. Fetch agent results from repository
    const results = getAgentResults(checkId, db);

    const res = Response.json(
      { agentResults: results },
      {
        status: 200,
        headers: noStoreHeaders(),
      }
    );

    reqLogger.logResponse(200);
    return applySecurityHeaders(res);
  } catch (err) {
    const errorRes = toResponse(err, noStoreHeaders());
    reqLogger.logError(err, errorRes.status);
    return applySecurityHeaders(errorRes);
  }
}

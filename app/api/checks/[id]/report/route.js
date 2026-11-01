import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck, getReport } from "../../../../../lib/db/index.js";
import { ReportSchema } from "../../../../../lib/contracts/report.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/checks/:id/report
 *
 * Retrieves the generated final risk report.
 * Returns 404 for unknown checks, 410 for expired checks,
 * and 409 STATE_CONFLICT when status is not "report_ready".
 * Validates the retrieved report against ReportSchema before returning.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/report");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db, logger } = runtimeDeps;

  try {
    // 1. Rate Limiting per IP
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    rateLimiters.getCheck.assertAllowed(clientKey);

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

    // 4. Verify check status is report_ready
    if (check.status !== "report_ready") {
      throw apiError(
        "STATE_CONFLICT",
        `Report not ready for check in status '${check.status}'`,
        409,
        { status: check.status }
      );
    }

    // 5. Fetch report from database
    const rawReport = getReport(checkId, db);
    if (!rawReport) {
      throw apiError("NOT_FOUND", "Report not found for ready check", 404);
    }

    // 6. Validate retrieved report against ReportSchema contract
    const validation = ReportSchema.safeParse(rawReport);
    if (!validation.success) {
      logger.error(
        { checkId, issues: validation.error.issues.map((i) => i.message) },
        "Stored report failed schema validation"
      );
      throw apiError("INTERNAL_ERROR", "Internal server error", 500);
    }

    const res = Response.json(
      { report: validation.data },
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

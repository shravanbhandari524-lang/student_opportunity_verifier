import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId, parseJsonBody } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck, getReport } from "../../../../../lib/db/index.js";
import { FraudSummaryRequestSchema } from "../../../../../lib/contracts/actions.js";
import { ReportSchema } from "../../../../../lib/contracts/report.js";
import { buildFraudSummary } from "../../../../../lib/actions/index.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles POST /api/checks/:id/fraud-summary
 * Builds a deterministic cybercrime and bank dispute complaint narrative.
 *
 * Preconditions:
 * - Check exists and has status === "report_ready" (otherwise 409 STATE_CONFLICT).
 * - Not expired (otherwise 410 CHECK_EXPIRED).
 * - Body parsed with zero-echo validation (400 BAD_REQUEST on invalid schema).
 * - Ephemeral: never stored in database.
 */
export async function POST(request, context) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/fraud-summary");

  try {
    const { id } = await context.params;
    const checkId = assertValidCheckId(id);
    reqLogger.setCheckId(checkId);

    // Rate limiting: action limiter
    const clientKey = getClientKey(request, {
      trustProxy: env.TRUST_PROXY,
      trustedHops: env.TRUSTED_PROXY_HOPS,
    });
    const rt = context?.runtime || getRuntime();
    rt.rateLimiters.actionCheck.assertAllowed(clientKey);

    // Parse and validate request body
    const body = await parseJsonBody(request, FraudSummaryRequestSchema, 65536);

    // Fetch check from database
    const check = getCheck(checkId, rt.db);
    if (!check) {
      throw apiError("NOT_FOUND", `Check with ID ${checkId} not found`, 404);
    }

    // Verify expiration
    const now = new Date();
    if (new Date(check.expiresAt) <= now) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    // Verify lifecycle state: allowed strictly when status is report_ready
    if (check.status !== "report_ready") {
      throw apiError(
        "STATE_CONFLICT",
        `Action requires check to be report_ready (current status is '${check.status}')`,
        409
      );
    }

    // Fetch stored report
    const rawReport = getReport(checkId, rt.db);
    if (!rawReport) {
      throw apiError("NOT_FOUND", `Report for check ID ${checkId} not found`, 404);
    }

    const report = ReportSchema.parse(rawReport);

    // Build fraud summary deterministically
    const result = buildFraudSummary(report, body);

    const res = Response.json(result, {
      status: 200,
      headers: noStoreHeaders(),
    });

    reqLogger.logResponse(200);
    return applySecurityHeaders(res);
  } catch (err) {
    const errorRes = toResponse(err, noStoreHeaders());
    reqLogger.logError(err, errorRes.status);
    return applySecurityHeaders(errorRes);
  }
}

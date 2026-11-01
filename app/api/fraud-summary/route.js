import { getRuntime } from "../../../lib/api/runtime.js";
import { parseJsonBody } from "../../../lib/api/validate.js";
import { toResponse } from "../../../lib/api/errors.js";
import { getClientKey } from "../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../lib/api/headers.js";
import { createRequestLogger } from "../../../lib/api/log.js";
import { FraudSummaryRequestSchema } from "../../../lib/contracts/actions.js";
import { buildFraudSummary } from "../../../lib/actions/index.js";
import { env } from "../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles POST /api/fraud-summary
 * Standalone fraud summary complaint builder without check ID.
 *
 * Preconditions:
 * - Body parsed with zero-echo validation (400 BAD_REQUEST on invalid schema).
 * - Action rate limiter applied (429 RATE_LIMITED on excess calls).
 * - Ephemeral: nothing stored, zero database reads or writes.
 * - Narrative states that no check investigation evidence is attached.
 */
export async function POST(request, context) {
  const reqLogger = createRequestLogger(request, "/api/fraud-summary");

  try {
    // Rate limiting: action limiter
    const clientKey = getClientKey(request, {
      trustProxy: env.TRUST_PROXY,
      trustedHops: env.TRUSTED_PROXY_HOPS,
    });
    const rt = context?.runtime || getRuntime();
    rt.rateLimiters.actionCheck.assertAllowed(clientKey);

    // Parse and validate request body
    const body = await parseJsonBody(request, FraudSummaryRequestSchema, 65536);

    // Build fraud summary deterministically in standalone mode
    const result = buildFraudSummary(null, body);

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

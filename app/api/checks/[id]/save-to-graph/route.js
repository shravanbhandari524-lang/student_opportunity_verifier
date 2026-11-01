import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId, parseJsonBody } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck } from "../../../../../lib/db/index.js";
import { saveCheckIdentifiers } from "../../../../../lib/graph.js";
import { SaveToGraphRequestSchema } from "../../../../../lib/contracts/graph.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles POST /api/checks/:id/save-to-graph
 * Records qualifying verified identifiers into the scam intelligence graph.
 * Preconditions:
 * - consent === true in request body.
 * - Check exists and has status === "report_ready".
 * - Check has risk_level === "high".
 * - Exclusion rules apply (discovered, company, known domains, gov/edu domains, free email domains excluded).
 * - Per-check cap of 5 identifiers.
 */
export async function POST(request, context) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/save-to-graph");

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
    const body = await parseJsonBody(request, SaveToGraphRequestSchema, 65536);
    if (!body || body.consent !== true) {
      throw apiError("BAD_REQUEST", "User consent is required to save identifiers to graph", 400);
    }

    // Guard against saving synthetic identifiers to graph when running in replay or record mode
    const activeMode = context?.env?.RECORD_REPLAY_MODE || context?.runtime?.env?.RECORD_REPLAY_MODE || env.RECORD_REPLAY_MODE;
    if (activeMode && activeMode !== "off") {
      throw apiError(
        "STATE_CONFLICT",
        `Saving identifiers to graph is disabled while server is operating in ${activeMode} mode`,
        409,
        { reason: "replay_mode_active" }
      );
    }

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

    // Lifecycle state verification: strictly report_ready
    if (check.status !== "report_ready") {
      throw apiError(
        "STATE_CONFLICT",
        `Identifiers can only be saved to graph when report is ready (current status is '${check.status}')`,
        409
      );
    }

    // Risk level verification: strictly high
    if (check.riskLevel !== "high") {
      throw apiError(
        "STATE_CONFLICT",
        `Only high-risk checks can be recorded in the scam intelligence graph (current risk level is '${check.riskLevel}')`,
        409
      );
    }

    // Perform saveCheckIdentifiers
    const result = saveCheckIdentifiers(checkId, { consent: true, db: rt.db });

    const response = Response.json(
      {
        saved: result.saved,
        checkRef: result.checkRef,
        ...(result.reason ? { reason: result.reason } : {}),
      },
      {
        status: 200,
        headers: noStoreHeaders(),
      }
    );
    reqLogger.logResponse(200);
    return applySecurityHeaders(response);
  } catch (err) {
    const errorResponse = toResponse(err, noStoreHeaders());
    reqLogger.logError(err, errorResponse.status);
    return applySecurityHeaders(errorResponse);
  }
}

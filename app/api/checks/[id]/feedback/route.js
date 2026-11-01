import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId, parseJsonBody } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck, saveFeedbackUnique } from "../../../../../lib/db/index.js";
import { FeedbackRequestSchema } from "../../../../../lib/contracts/feedback.js";
import { redactComment } from "../../../../../lib/api/redaction.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles POST /api/checks/:id/feedback
 * Allows users to submit "right" or "wrong" feedback with optional outcome and comment.
 * Preconditions:
 * - Check exists and has status === "report_ready".
 * - Exactly one feedback per check (returns 409 STATE_CONFLICT on duplicate).
 * - Comments are sanitized using redactComment before database write.
 */
export async function POST(request, context) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/feedback");

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
    const body = await parseJsonBody(request, FeedbackRequestSchema, 65536);

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

    // Verify lifecycle state: feedback allowed strictly when status is report_ready
    if (check.status !== "report_ready") {
      throw apiError(
        "STATE_CONFLICT",
        `Feedback can only be submitted when report is ready (current status is '${check.status}')`,
        409
      );
    }

    // Sanitize comment to redact any personal identifiers
    const sanitizedComment = body.comment !== undefined && body.comment !== null
      ? redactComment(body.comment)
      : null;

    // Save feedback atomically, preventing duplicate feedback per checkId
    const saveResult = saveFeedbackUnique(
      {
        checkId,
        verdict: body.verdict,
        outcome: body.outcome ?? null,
        riskLevelShown: check.riskLevel || "cannot_verify",
        comment: sanitizedComment,
      },
      rt.db
    );

    if (saveResult.duplicate) {
      throw apiError("STATE_CONFLICT", "Feedback has already been submitted for this check", 409);
    }

    const response = Response.json(
      { ok: true, id: saveResult.feedback.id },
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

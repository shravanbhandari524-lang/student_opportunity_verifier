import { getRuntime } from "../../../../lib/api/runtime.js";
import { toResponse, apiError } from "../../../../lib/api/errors.js";
import { getClientKey } from "../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../lib/api/log.js";
import { getGuideByType } from "../../../../lib/guides/index.js";
import { GuideSchema } from "../../../../lib/contracts/guides.js";
import { env } from "../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles GET /api/guides/:type
 * Returns the full structured educational guide for :type.
 *
 * Preconditions:
 * - :type exists in GUIDE_TYPES (otherwise 404 NOT_FOUND).
 * - Validated against GuideSchema before returning.
 */
export async function GET(request, context) {
  const reqLogger = createRequestLogger(request, "/api/guides/[type]");

  try {
    const { type } = await context.params;

    // Rate limiting: guide limiter
    const clientKey = getClientKey(request, {
      trustProxy: env.TRUST_PROXY,
      trustedHops: env.TRUSTED_PROXY_HOPS,
    });
    const rt = context?.runtime || getRuntime();
    rt.rateLimiters.guideRead.assertAllowed(clientKey);

    // Fetch and validate guide
    const rawGuide = getGuideByType(type);
    if (!rawGuide) {
      throw apiError("NOT_FOUND", "Guide for requested type not found", 404);
    }

    const validatedGuide = GuideSchema.parse(rawGuide);

    const res = Response.json(validatedGuide, {
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

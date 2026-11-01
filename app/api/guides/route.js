import { getRuntime } from "../../../lib/api/runtime.js";
import { toResponse } from "../../../lib/api/errors.js";
import { getClientKey } from "../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../lib/api/headers.js";
import { createRequestLogger } from "../../../lib/api/log.js";
import { listGuides } from "../../../lib/guides/index.js";
import { GuideListResponseSchema } from "../../../lib/contracts/guides.js";
import { env } from "../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handles GET /api/guides
 * Returns list of guide summaries (type, title, summary).
 */
export async function GET(request, context) {
  const reqLogger = createRequestLogger(request, "/api/guides");

  try {
    // Rate limiting: guide limiter
    const clientKey = getClientKey(request, {
      trustProxy: env.TRUST_PROXY,
      trustedHops: env.TRUSTED_PROXY_HOPS,
    });
    const rt = context?.runtime || getRuntime();
    rt.rateLimiters.guideRead.assertAllowed(clientKey);

    // Retrieve guide summaries
    const rawGuides = listGuides();
    const validated = GuideListResponseSchema.parse({ guides: rawGuides });

    const res = Response.json(validated, {
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

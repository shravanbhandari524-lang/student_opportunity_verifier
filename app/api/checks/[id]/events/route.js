import { z } from "zod";
import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck, listEventsAfter } from "../../../../../lib/db/index.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EventsQuerySchema = z
  .object({
    after: z.coerce
      .number({ invalid_type_error: "after must be a valid number" })
      .int("after must be an integer")
      .min(0, "after must be non-negative")
      .default(0),
  })
  .strict();

/**
 * GET /api/checks/:id/events?after=<seq>
 *
 * Polling fallback endpoint for environments where SSE is blocked.
 * Features:
 * - Rate limited using streamCheck rate limiter
 * - Query parameter validation via Zod
 * - Returns { events: TraceEvent[] } with seq > after ordered by seq ASC
 * - Applies standard security and no-store caching headers
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/events");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db } = runtimeDeps;

  try {
    // 1. Rate Limiting per IP (shared with stream access rule)
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    if (rateLimiters?.streamCheck) {
      rateLimiters.streamCheck.assertAllowed(clientKey);
    }

    // 2. Validate Check ID (UUID v4)
    const params = await context.params;
    const rawId = params?.id;
    const checkId = assertValidCheckId(rawId);
    reqLogger.setCheckId(checkId);

    // 3. Verify check exists in database
    const check = getCheck(checkId, db);
    if (!check) {
      throw apiError("NOT_FOUND", "Check not found", 404);
    }

    // 4. Check expiration (24h TTL)
    const nowIso = new Date().toISOString();
    if (check.expiresAt && check.expiresAt < nowIso) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    // 5. Parse and validate query parameter ?after=<seq>
    const url = new URL(request.url);
    const rawAfter = url.searchParams.get("after") ?? "0";
    const parseResult = EventsQuerySchema.safeParse({ after: rawAfter });
    if (!parseResult.success) {
      throw apiError(
        "BAD_REQUEST",
        "Invalid query parameter 'after'",
        400,
        { issues: parseResult.error.issues }
      );
    }

    const afterSeq = parseResult.data.after;

    // 6. Fetch incremental events from database
    const events = listEventsAfter(checkId, afterSeq, db);

    const res = Response.json(
      { events },
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

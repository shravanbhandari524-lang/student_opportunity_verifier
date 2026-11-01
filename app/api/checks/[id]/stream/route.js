import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck } from "../../../../../lib/db/index.js";
import { env } from "../../../../../lib/env.js";
import { parseLastEventId, streamEvents, formatEvent } from "../../../../../lib/api/sse.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/checks/:id/stream
 *
 * Server-Sent Events (SSE) endpoint providing real-time progress updates.
 * Features:
 * - Rate limited per IP
 * - Per-check subscriber concurrency cap (max 25 subscribers per checkId)
 * - Last-Event-ID replay of missing events
 * - Bus wake-up with polling fallback
 * - Periodic keepalive comment ping
 * - Automatic connection closure on terminal event, completion, or 5-minute cap
 * - PII and internal error sanitization
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/stream");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db, eventBus } = runtimeDeps;

  try {
    // 1. Rate Limiting per IP
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

    // 5. Per-check subscriber cap check
    const currentSubscribers = eventBus?.listenerCount ? eventBus.listenerCount(checkId) : 0;
    if (currentSubscribers >= 25) {
      const res503 = apiError(
        "SERVICE_UNAVAILABLE",
        "Too many active stream connections for this check. Please retry shortly.",
        503
      );
      res503.headers = { "Retry-After": "10" };
      throw res503;
    }

    // 6. Parse Last-Event-ID if provided
    const lastEventId = parseLastEventId(request);

    // 7. Setup async iterator and ReadableStream
    const iterator = streamEvents({
      checkId,
      lastEventId,
      db,
      bus: eventBus,
      signal: request.signal,
    });

    let sentInitialRetry = false;

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          if (!sentInitialRetry) {
            sentInitialRetry = true;
            // Emit retry interval hint so clients know reconnection backoff
            const retryFrame = formatEvent({ retryMs: 3000, data: { type: "connected" } });
            controller.enqueue(new TextEncoder().encode(retryFrame));
          }

          const { value, done } = await iterator.next();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(new TextEncoder().encode(value));
          }
        } catch (err) {
          controller.error(err);
        }
      },
      cancel() {
        if (typeof iterator.return === "function") {
          iterator.return();
        }
      },
    });

    const sseHeaders = {
      ...noStoreHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    };

    const response = new Response(stream, {
      status: 200,
      headers: sseHeaders,
    });

    reqLogger.logResponse(200);
    return applySecurityHeaders(response);
  } catch (err) {
    const errorRes = toResponse(err, noStoreHeaders());
    if (errorRes.status === 503) {
      errorRes.headers.set("Retry-After", "10");
    }
    reqLogger.logError(err, errorRes.status);
    return applySecurityHeaders(errorRes);
  }
}

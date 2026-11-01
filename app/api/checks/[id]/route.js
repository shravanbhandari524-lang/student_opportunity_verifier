import { getRuntime } from "../../../../lib/api/runtime.js";
import { assertValidCheckId } from "../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../lib/api/errors.js";
import { getClientKey } from "../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../lib/api/log.js";
import { getCheck, getEntities, getInputs, getEvents } from "../../../../lib/db/index.js";
import { env } from "../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/checks/:id
 *
 * Polling endpoint for check progress, summary and entities.
 * Strictly filters exposed fields: never returns filePath, image bytes,
 * raw stack traces or internal input row IDs.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db } = runtimeDeps;

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

    // 3. Fetch check from database
    const check = getCheck(checkId, db);
    if (!check) {
      throw apiError("NOT_FOUND", "Check not found", 404);
    }

    // 4. Check expiration (24h TTL)
    const nowIso = new Date().toISOString();
    if (check.expiresAt && check.expiresAt < nowIso) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    // 5. Build strictly safe CheckSummary response
    const checkSummary = {
      id: check.id,
      status: check.status,
      currentRound: check.currentRound,
      language: check.language,
      riskLevel: check.riskLevel || null,
      score: check.score !== undefined ? check.score : null,
      confidence: check.confidence || null,
      failureReason: check.status === "failed" ? (check.failureReason || null) : null,
      createdAt: check.createdAt,
      updatedAt: check.updatedAt,
      expiresAt: check.expiresAt,
    };

    // 6. When status is awaiting_confirmation or later, provide editable text & extracted entities
    let entities = [];
    let text = null;

    const stagesWithEntities = [
      "awaiting_confirmation",
      "investigating",
      "scoring",
      "report_ready",
      "failed",
    ];

    if (stagesWithEntities.includes(check.status)) {
      const dbEntities = getEntities(checkId, db);
      entities = dbEntities.map((e) => ({
        id: e.id,
        kind: e.kind,
        value: e.value,
        platform: e.platform || undefined,
        orgType: e.orgType || undefined,
        purpose: e.purpose || undefined,
        source: e.source,
        confirmed: Boolean(e.confirmed),
      }));

      const inputs = getInputs(checkId, db);
      const textInput = inputs.find((i) => i.type === "text");
      if (textInput && textInput.value) {
        text = textInput.value;
      }
    }

    const payload = {
      check: checkSummary,
      entities,
    };
    if (text !== null) {
      payload.text = text;
    }

    // Surface extraction fallback notes if entity sweep was unavailable
    const events = getEvents(checkId, db);
    const fallbackEv = events.find((ev) => {
      if (ev.round === 0) {
        if (
          ev.summary?.includes("entity sweep unavailable") ||
          ev.summary?.includes("sweep unavailable") ||
          ev.summary?.includes("fallback")
        ) {
          return true;
        }
        try {
          const p = ev.payload_json ? JSON.parse(ev.payload_json) : null;
          if (p?.extractionNotes) return true;
        } catch {}
      }
      return false;
    });

    if (fallbackEv) {
      let notes = "entity sweep unavailable; companies and handles may be incomplete";
      try {
        const p = fallbackEv.payload_json ? JSON.parse(fallbackEv.payload_json) : null;
        if (p?.extractionNotes) notes = p.extractionNotes;
      } catch {}
      payload.extractionNotes = notes;
    }

    const res = Response.json(payload, {
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

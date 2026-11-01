import { z } from "zod";
import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId, parseJsonBody } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck, getInputs, saveConfirmation, updateStatus, transitionStatus, InvalidStateTransitionError } from "../../../../../lib/db/index.js";
import { runInvestigation } from "../../../../../lib/coordinator.js";
import { ENTITY_KINDS } from "../../../../../lib/contracts/enums.js";
import {
  normalizeDomain,
  normalizeUpi,
  normalizeEmail,
  normalizeAmount,
  normalizeCompany,
  normalizeHandle,
} from "../../../../../lib/contracts/normalize.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ConfirmedEntitySchema = z
  .object({
    kind: z.enum(ENTITY_KINDS),
    value: z.string().min(1).max(500),
    source: z.string().optional().default("user"),
    platform: z.string().nullable().optional(),
    orgType: z.string().nullable().optional(),
    purpose: z.string().nullable().optional(),
    evidence: z.any().optional(),
  })
  .passthrough();

const ConfirmationBodySchema = z
  .object({
    texts: z.array(z.string().max(10000)).max(10).optional(),
    entities: z.array(ConfirmedEntitySchema).max(30).optional().default([]),
  })
  .strict();

function normalizeConfirmedValue(kind, value) {
  switch (kind) {
    case "domain":
      return normalizeDomain(value);
    case "url":
    case "youtube_url":
      return value.trim();
    case "upi":
      return normalizeUpi(value);
    case "email":
      return normalizeEmail(value);
    case "amount":
      return normalizeAmount(value);
    case "company":
      return normalizeCompany(value);
    case "handle":
      return normalizeHandle(value);
    case "phone":
      return value.trim();
    default:
      return value.trim();
  }
}

/**
 * POST /api/checks/:id/confirm
 *
 * Confirms user-reviewed text and extracted entities.
 * Allowed only when status is "awaiting_confirmation".
 * Calls saveConfirmation and initiates background investigation via jobRunner.
 */
export async function POST(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/confirm");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, jobRunner, db, logger } = runtimeDeps;

  try {
    // 1. Rate Limiting per IP
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    rateLimiters.confirmCheck.assertAllowed(clientKey);

    // 2. Validate Check ID (UUID v4)
    const params = await context.params;
    const rawId = params?.id;
    const checkId = assertValidCheckId(rawId);
    reqLogger.setCheckId(checkId);

    // 3. Verify check existence, expiration, and status
    const check = getCheck(checkId, db);
    if (!check) {
      throw apiError("NOT_FOUND", "Check not found", 404);
    }

    const nowIso = new Date().toISOString();
    if (check.expiresAt && check.expiresAt < nowIso) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    // Idempotency: if check is already investigating, scoring, or report_ready, return HTTP 200 immediately
    if (check.status === "investigating" || check.status === "scoring" || check.status === "report_ready") {
      // Ensure coordinator is actively running if status is investigating
      if (check.status === "investigating" && !jobRunner.isActive(checkId)) {
        try {
          const coordinatorDeps = context.coordinatorDeps || {
            db,
            logger,
            onEvent: () => {
              if (runtimeDeps.eventBus) {
                runtimeDeps.eventBus.notify(checkId);
              }
            },
          };
          const resumePromise = jobRunner.run(checkId, async () => {
            try {
              await runInvestigation(checkId, coordinatorDeps, { resume: true });
            } catch (err) {
              logger.error({ checkId, err: err?.message }, "Resumed background investigation failed");
            } finally {
              if (runtimeDeps.eventBus) {
                runtimeDeps.eventBus.notify(checkId);
              }
            }
          });
          if (resumePromise && typeof resumePromise.catch === "function") {
            resumePromise.catch((err) => {
              logger.error({ checkId, err: err?.message }, "Failed to resume investigation runner");
            });
          }
        } catch (_e) {}
      }

      const res = Response.json(
        { checkId, status: check.status },
        {
          status: 200,
          headers: noStoreHeaders(),
        }
      );
      reqLogger.logResponse(200, { checkId, status: check.status, idempotent: true });
      return applySecurityHeaders(res);
    }

    if (check.status !== "awaiting_confirmation") {
      throw apiError(
        "STATE_CONFLICT",
        `Confirmation not allowed for check in status '${check.status}' (must be awaiting_confirmation)`,
        409,
        { status: check.status }
      );
    }

    // 4. Parse & Validate request body
    const body = await parseJsonBody(request, ConfirmationBodySchema, 1024 * 1024);

    // Normalize entity values
    const normalizedEntities = body.entities.map((ent) => ({
      ...ent,
      value: normalizeConfirmedValue(ent.kind, ent.value),
    }));

    // If texts were not provided in confirmation body, preserve existing text inputs
    let textsToConfirm = body.texts;
    if (!textsToConfirm || textsToConfirm.length === 0) {
      const existingInputs = getInputs(checkId, db);
      const existingTexts = existingInputs
        .filter((i) => i.type === "text" && i.value)
        .map((i) => i.value);
      if (existingTexts.length > 0) {
        textsToConfirm = existingTexts;
      }
    }

    // 5. Atomic saveConfirmation and transition from 'awaiting_confirmation' to 'investigating'
    try {
      saveConfirmation(checkId, { texts: textsToConfirm, entities: normalizedEntities }, db);
      transitionStatus(checkId, "awaiting_confirmation", "investigating", db);
    } catch (err) {
      if (err instanceof InvalidStateTransitionError || err?.code === "INVALID_STATE_TRANSITION") {
        // Concurrently transitioned by another request -> return idempotent 200 without calling jobRunner.run
        const current = getCheck(checkId, db);
        if (
          current &&
          (current.status === "investigating" ||
            current.status === "scoring" ||
            current.status === "report_ready")
        ) {
          const res = Response.json(
            { checkId, status: current.status },
            {
              status: 200,
              headers: noStoreHeaders(),
            }
          );
          reqLogger.logResponse(200, { checkId, status: current.status, idempotent: true });
          return applySecurityHeaders(res);
        }
      }
      throw err;
    }

    // 6. Launch background investigation via jobRunner (only the transitioning request reaches here)
    try {
      const coordinatorDeps = context.coordinatorDeps || {
        db,
        logger,
        onEvent: () => {
          if (runtimeDeps.eventBus) {
            runtimeDeps.eventBus.notify(checkId);
          }
        },
      };

      const jobPromise = jobRunner.run(checkId, async () => {
        try {
          await runInvestigation(checkId, coordinatorDeps, { resume: true });
        } catch (err) {
          logger.error({ checkId, err: err?.message }, "Background investigation job failed");
        } finally {
          if (runtimeDeps.eventBus) {
            runtimeDeps.eventBus.notify(checkId);
          }
        }
      });

      if (jobPromise && typeof jobPromise.catch === "function") {
        jobPromise.catch((err) => {
          logger.error({ checkId, err: err?.message }, "Background investigation runner error");
        });
      }
    } catch (runnerErr) {
      if (runnerErr && runnerErr.code === "SERVICE_UNAVAILABLE") {
        // Concurrency cap reached. Rollback status to awaiting_confirmation so client can retry
        try {
          updateStatus(checkId, "awaiting_confirmation", db);
        } catch (_e) {}

        throw apiError(
          "SERVICE_UNAVAILABLE",
          "Server capacity exceeded. Please retry in 10 seconds.",
          503
        );
      }
      throw runnerErr;
    }

    const res = Response.json(
      { checkId, status: "investigating" },
      {
        status: 200,
        headers: noStoreHeaders(),
      }
    );

    reqLogger.logResponse(200, { activeJobs: jobRunner.activeCount() });
    return applySecurityHeaders(res);
  } catch (err) {
    const errorRes = toResponse(err, noStoreHeaders());
    if (errorRes.status === 503) {
      errorRes.headers.set("Retry-After", "10");
    }
    reqLogger.logError(err, errorRes.status);
    return applySecurityHeaders(errorRes);
  }
}

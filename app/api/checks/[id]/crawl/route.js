import { z } from "zod";
import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId, parseJsonBody } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import {
  getCheck,
  getEntities,
  createCrawl,
  markCrawlDone,
  markCrawlFailed,
  getCrawl
} from "../../../../../lib/db/index.js";
import { runCrawl } from "../../../../../lib/crawler.js";
import { assertPublicUrl } from "../../../../../lib/tools/ssrf.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CrawlRequestBodySchema = z
  .object({
    entityId: z.string().min(1, "entityId is required"),
  })
  .strict();

/**
 * Resolves full target URL from entity and verifies it against SSRF guard.
 *
 * @param {object} entity
 * @param {(host: string) => Promise<string[]>} [dnsResolver]
 * @returns {Promise<string>} Validated public URL
 */
async function resolveAndVerifyTargetUrl(entity, dnsResolver) {
  let targetUrl;
  if (entity.kind === "url") {
    targetUrl = entity.value.trim();
  } else if (entity.kind === "domain") {
    targetUrl = `https://${entity.value.trim()}`;
  } else {
    throw apiError("CRAWL_NOT_ALLOWED", "Only url or domain entities can be crawled", 400);
  }

  try {
    await assertPublicUrl(targetUrl, { resolve: dnsResolver });
    return targetUrl;
  } catch (err) {
    throw apiError("CRAWL_NOT_ALLOWED", `Target URL violates safety policies: ${err.message}`, 400);
  }
}

/**
 * POST /api/checks/:id/crawl
 * Triggers a read-only shallow crawl for a confirmed domain or url entity.
 */
export async function POST(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/crawl");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, crawlJobRunner, db, logger } = runtimeDeps;

  try {
    const { id } = await context.params;
    const checkId = assertValidCheckId(id);
    reqLogger.setCheckId(checkId);

    // 1. Action rate limiter
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    rateLimiters.actionCheck.assertAllowed(clientKey);

    // 2. Parse request body
    const body = await parseJsonBody(request, CrawlRequestBodySchema, 1024);
    const { entityId } = body;

    // 3. Verify check existence and expiration
    const check = getCheck(checkId, db);
    if (!check) {
      throw apiError("NOT_FOUND", `Check with ID ${checkId} not found`, 404);
    }

    const now = new Date();
    if (new Date(check.expiresAt) <= now) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    // 4. Verify check is report_ready
    if (check.status !== "report_ready") {
      throw apiError(
        "STATE_CONFLICT",
        `Crawl can only be initiated when report is ready (current status is '${check.status}')`,
        409
      );
    }

    // 5. Look up entity and ensure confirmed url or domain
    const entities = getEntities(checkId, db);
    const entity = entities.find(
      (e) => String(e.id) === String(entityId)
    );

    if (!entity) {
      throw apiError("CRAWL_NOT_ALLOWED", `Entity ${entityId} not found in check`, 400);
    }

    if (!entity.confirmed) {
      throw apiError("CRAWL_NOT_ALLOWED", `Entity ${entityId} is not confirmed`, 400);
    }

    if (entity.kind !== "url" && entity.kind !== "domain") {
      throw apiError("CRAWL_NOT_ALLOWED", "Only url or domain entities can be crawled", 400);
    }

    // 6. Validate target URL through SSRF guard
    const targetUrl = await resolveAndVerifyTargetUrl(entity, context.dnsResolver);

    // 7. Check existing crawl record (Idempotency and Retry handling)
    const existing = getCrawl(checkId, entityId, db);
    if (existing) {
      if (existing.status === "running") {
        const res = Response.json(
          { status: "running", checkId, entityId },
          { status: 200, headers: noStoreHeaders() }
        );
        return applySecurityHeaders(res);
      }
      if (existing.status === "done") {
        const res = Response.json(
          { status: "done", checkId, entityId, result: existing.result },
          { status: 200, headers: noStoreHeaders() }
        );
        return applySecurityHeaders(res);
      }
      // If status === 'failed', we allow retrying: createCrawl will reset it to 'running'
    }

    // 8. Create or reset crawl record in 'running' status
    createCrawl(checkId, entityId, new Date().toISOString(), db);

    // 9. Launch background crawl via crawlJobRunner
    const runner = crawlJobRunner || runtimeDeps.jobRunner;
    const crawlerOptions = context.crawlerOptions || {};

    const jobPromise = runner.run(`${checkId}:${entityId}`, async () => {
      try {
        const res = await runCrawl(targetUrl, crawlerOptions);
        if (res.ok) {
          markCrawlDone(checkId, entityId, res.result, new Date().toISOString(), db);
        } else {
          markCrawlFailed(checkId, entityId, res.reason || "crawl_failed", new Date().toISOString(), db);
        }
      } catch (err) {
        logger.error({ checkId, entityId, err: err?.message }, "Background crawl execution failed");
        markCrawlFailed(checkId, entityId, "exception", new Date().toISOString(), db);
      }
    });

    // Check capacity: if runner rejected (e.g. 503 SERVICE_UNAVAILABLE), jobPromise rejects immediately.
    // If accepted, Promise.resolve wins immediately and crawl runs in the background.
    await Promise.race([jobPromise, Promise.resolve("started")]);

    const response = Response.json(
      { status: "running", checkId, entityId },
      { status: 202, headers: noStoreHeaders() }
    );
    return applySecurityHeaders(response);
  } catch (err) {
    const errorRes = toResponse(err, noStoreHeaders());
    if (errorRes.status === 503) {
      errorRes.headers.set("Retry-After", "10");
    }
    return applySecurityHeaders(errorRes);
  }
}

/**
 * GET /api/checks/:id/crawl?entityId=...
 * Retrieves current crawl status and result.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/crawl");
  const runtimeDeps = context.runtime || getRuntime();
  const { db } = runtimeDeps;

  try {
    const { id } = await context.params;
    const checkId = assertValidCheckId(id);
    reqLogger.setCheckId(checkId);

    const url = new URL(request.url);
    const entityId = url.searchParams.get("entityId");
    if (!entityId || !entityId.trim()) {
      throw apiError("BAD_REQUEST", "Query parameter 'entityId' is required", 400);
    }

    const check = getCheck(checkId, db);
    if (!check) {
      throw apiError("NOT_FOUND", `Check with ID ${checkId} not found`, 404);
    }

    const now = new Date();
    if (new Date(check.expiresAt) <= now) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    const crawl = getCrawl(checkId, entityId.trim(), db);
    if (!crawl) {
      const res = Response.json(
        { status: "not_started" },
        { status: 200, headers: noStoreHeaders() }
      );
      return applySecurityHeaders(res);
    }

    if (crawl.status === "running") {
      const res = Response.json(
        { status: "running" },
        { status: 200, headers: noStoreHeaders() }
      );
      return applySecurityHeaders(res);
    }

    if (crawl.status === "done") {
      const res = Response.json(
        { status: "done", result: crawl.result },
        { status: 200, headers: noStoreHeaders() }
      );
      return applySecurityHeaders(res);
    }

    // Failed status
    const res = Response.json(
      { status: "failed", errorCode: crawl.errorCode },
      { status: 200, headers: noStoreHeaders() }
    );
    return applySecurityHeaders(res);
  } catch (err) {
    const errorRes = toResponse(err, noStoreHeaders());
    return applySecurityHeaders(errorRes);
  }
}

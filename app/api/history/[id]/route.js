import { getRuntime } from "../../../../lib/api/runtime.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../lib/api/log.js";
import { toResponse, apiError } from "../../../../lib/api/errors.js";
import { getRunRecord } from "../../../../lib/db/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/history/[id]
 *
 * Returns full verification run record with timeline of agents, steps, and summaries.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/history/[id]");
  const runtimeDeps = context.runtime || getRuntime();
  const { db } = runtimeDeps;

  try {
    const params = await (context.params || {});
    const runId = params.id;

    if (!runId) {
      throw apiError("INVALID_ARGUMENT", "Run ID is required", 400);
    }

    const record = getRunRecord(runId, db);
    if (!record) {
      throw apiError("NOT_FOUND", "Run record not found", 404);
    }

    const headers = new Headers(noStoreHeaders());
    headers.set("Content-Type", "application/json");

    reqLogger.logResponse(200);
    return applySecurityHeaders(
      new Response(JSON.stringify(record), {
        status: 200,
        headers,
      })
    );
  } catch (err) {
    reqLogger.logError(err, err.status || 500);
    return toResponse(err);
  }
}

import { getRuntime } from "../../../lib/api/runtime.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../lib/api/headers.js";
import { createRequestLogger } from "../../../lib/api/log.js";
import { toResponse } from "../../../lib/api/errors.js";
import { listRunRecords } from "../../../lib/db/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/history
 *
 * Returns list of verification runs: id, date, input, score, verdict.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/history");
  const runtimeDeps = context.runtime || getRuntime();
  const { db } = runtimeDeps;

  try {
    const runs = listRunRecords(100, db);

    const headers = new Headers(noStoreHeaders());
    headers.set("Content-Type", "application/json");

    reqLogger.logResponse(200);
    return applySecurityHeaders(
      new Response(JSON.stringify(runs), {
        status: 200,
        headers,
      })
    );
  } catch (err) {
    reqLogger.logError(err);
    return toResponse(err);
  }
}

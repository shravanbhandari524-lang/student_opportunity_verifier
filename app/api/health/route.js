import { z } from "zod";
import { generate } from "../../../lib/llm/generate.js";
import { env } from "../../../lib/env.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../lib/api/headers.js";
import { createRequestLogger } from "../../../lib/api/log.js";
import { toResponse } from "../../../lib/api/errors.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tinyTestSchema = z.object({
  status: z.literal("ok"),
  greeting: z.string(),
});

/**
 * GET /api/health
 *
 * Health check endpoint for process uptime and optional LLM connectivity check (?llm=1).
 * Applies standard security headers and no-store caching headers.
 */
export async function GET(request) {
  const reqLogger = createRequestLogger(request, "/api/health");

  try {
    const url = new URL(request.url);
    const testLlm = url.searchParams.get("llm") === "1";

    const result = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      replayMode: env.RECORD_REPLAY_MODE || "off",
    };

    if (testLlm) {
      try {
        const res = await generate({
          prompt: 'Respond with a JSON object: {"status": "ok", "greeting": "hello"}',
          schema: tinyTestSchema,
          timeoutMs: 10000,
          customEnv: env,
        });

        if (res.ok) {
          result.llm = { status: "ok", result: res.data };
        } else {
          result.llm = { status: "error", message: res.error.message, code: res.error.code };
          const response503 = Response.json(result, {
            status: 503,
            headers: noStoreHeaders(),
          });
          reqLogger.logResponse(503);
          return applySecurityHeaders(response503);
        }
      } catch (err) {
        result.llm = { status: "error", message: err.message };
        const response503 = Response.json(result, {
          status: 503,
          headers: noStoreHeaders(),
        });
        reqLogger.logResponse(503);
        return applySecurityHeaders(response503);
      }
    }

    const response = Response.json(result, {
      status: 200,
      headers: noStoreHeaders(),
    });
    reqLogger.logResponse(200);
    return applySecurityHeaders(response);
  } catch (err) {
    const errRes = toResponse(err, noStoreHeaders());
    reqLogger.logError(err, errRes.status);
    return applySecurityHeaders(errRes);
  }
}

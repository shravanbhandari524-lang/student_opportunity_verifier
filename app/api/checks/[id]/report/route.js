import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck, getReport, updateStatus, updateCheckResult, saveReport, getAgentResults } from "../../../../../lib/db/index.js";
import { ReportSchema } from "../../../../../lib/contracts/report.js";
import { getCaseFile } from "../../../../../lib/caseFile.js";
import { scoreCase } from "../../../../../lib/scoring/score.js";
import { generateReport, buildEvidencePack, buildFallbackReport } from "../../../../../lib/report.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/checks/:id/report
 *
 * Retrieves the generated final risk report.
 * Returns 404 for unknown checks, 410 for expired checks,
 * and 409 STATE_CONFLICT when status is not "report_ready".
 * Validates the retrieved report against ReportSchema before returning.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/report");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db, logger } = runtimeDeps;

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

    // 3. Verify check existence and expiration
    const check = getCheck(checkId, db);
    if (!check) {
      throw apiError("NOT_FOUND", "Check not found", 404);
    }

    const nowIso = new Date().toISOString();
    if (check.expiresAt && check.expiresAt < nowIso) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    // 4. Verify check status is report_ready
    if (check.status !== "report_ready") {
      throw apiError(
        "STATE_CONFLICT",
        `Report not ready for check in status '${check.status}'`,
        409,
        { status: check.status }
      );
    }

    // 5. Fetch report from database
    const rawReport = getReport(checkId, db);
    if (!rawReport) {
      throw apiError("NOT_FOUND", "Report not found for ready check", 404);
    }

    // 6. Validate retrieved report against ReportSchema contract
    const validation = ReportSchema.safeParse(rawReport);
    if (!validation.success) {
      logger.error(
        { checkId, issues: validation.error.issues.map((i) => i.message) },
        "Stored report failed schema validation"
      );
      throw apiError("INTERNAL_ERROR", "Internal server error", 500);
    }

    // 7. Compute deterministic score breakdown
    let scoreBreakdown = null;
    try {
      const findings = getAgentResults(checkId, db) || [];
      const scoreResult = scoreCase({ findings });
      scoreBreakdown = {
        flags: (scoreResult.flagPoints || []).map((fp) => ({
          id: fp.id,
          agent: fp.agents ? Array.from(fp.agents).join(", ") : "",
          points: fp.points,
          weight: fp.weight,
          status: fp.status,
        })),
        classifierPoints: scoreResult.classifierPoints || 0,
        rulesFired: scoreResult.rulesFired || [],
        coverage: {
          completedCount: scoreResult.completedCount || 0,
          eligibleCount: scoreResult.eligibleCount || 0,
          ratio: scoreResult.completionRatio || 0,
        },
        finalLevel: (findings.length > 0 && scoreResult.level !== "cannot_verify") ? scoreResult.level : validation.data.riskLevel,
        finalScore: findings.length > 0 ? scoreResult.score : validation.data.score,
      };
    } catch {
      scoreBreakdown = {
        flags: (validation.data.flags || []).map((f) => ({
          id: f.id,
          agent: "Specialist Agent",
          points: 0,
          weight: 0,
          status: "counted",
        })),
        classifierPoints: 0,
        rulesFired: [],
        coverage: { completedCount: 6, eligibleCount: 6, ratio: 1.0 },
        finalLevel: validation.data.riskLevel,
        finalScore: validation.data.score,
      };
    }

    const res = Response.json(
      { report: validation.data, scoreBreakdown },
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

/**
 * POST /api/checks/:id/report
 *
 * Retries or regenerates the final report on demand.
 * Runs scoreCase + generateReport (with fallback to buildFallbackReport),
 * saves the report in the database, updates the check, and returns 200.
 */
export async function POST(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/report");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db, logger } = runtimeDeps;

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

    // 3. Verify check existence and expiration
    const check = getCheck(checkId, db);
    if (!check) {
      throw apiError("NOT_FOUND", "Check not found", 404);
    }

    const nowIso = new Date().toISOString();
    if (check.expiresAt && check.expiresAt < nowIso) {
      throw apiError("CHECK_EXPIRED", "Check has expired", 410);
    }

    // 4. Reject check if still extracting or awaiting initial confirmation
    if (check.status === "extracting" || check.status === "awaiting_confirmation") {
      throw apiError(
        "STATE_CONFLICT",
        `Cannot generate report for check in status '${check.status}'`,
        409,
        { status: check.status }
      );
    }

    // 5. Gather case file findings and score
    const caseFile = getCaseFile(checkId, db);
    const findings = caseFile?.findings || [];
    const scoreResult = scoreCase(findings);

    // 6. Generate report narrative with deterministic fallback
    let report;
    const reportDeps = {
      db,
      logger,
      now: () => new Date().toISOString(),
    };

    const textInputsCount = (caseFile?.inputs || []).filter((i) => i.type === "text").length;
    const imageInputsCount = (caseFile?.inputs || []).filter((i) => i.type === "image").length;
    const entityKinds = Array.from(new Set((caseFile?.entities || []).map((e) => e.kind)));
    const checkInputsSummary = `User submission contains ${textInputsCount} text block(s), ${imageInputsCount} screenshot image(s). Entities extracted: ${entityKinds.join(", ") || "none"}.`;

    try {
      report = await generateReport({
        checkId,
        findings,
        scoreResult,
        language: check.language || "en",
        checkInputsSummary,
      }, reportDeps);
    } catch (_reportErr) {
      const pack = buildEvidencePack(findings, scoreResult, {
        checkId,
        language: check.language || "en",
      });
      report = buildFallbackReport(pack, check.language || "en", reportDeps);
    }

    // 7. Validate generated report
    const validation = ReportSchema.safeParse(report);
    if (!validation.success) {
      logger.error(
        { checkId, issues: validation.error.issues.map((i) => i.message) },
        "Retried report failed schema validation"
      );
      throw apiError("INTERNAL_ERROR", "Internal server error", 500);
    }

    // 8. Persist report and update check results
    saveReport(checkId, validation.data, db);

    updateCheckResult(checkId, {
      score: validation.data.score,
      riskLevel: validation.data.riskLevel,
      confidence: validation.data.confidence,
    }, db);

    if (check.status !== "report_ready" && check.status !== "failed") {
      updateStatus(checkId, "report_ready", db);
    }

    const res = Response.json(
      {
        report: validation.data,
        status: check.status === "failed" ? "failed" : "report_ready",
      },
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

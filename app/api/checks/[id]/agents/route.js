import { getRuntime } from "../../../../../lib/api/runtime.js";
import { assertValidCheckId } from "../../../../../lib/api/validate.js";
import { toResponse, apiError } from "../../../../../lib/api/errors.js";
import { getClientKey } from "../../../../../lib/api/rate-limit.js";
import { applySecurityHeaders, noStoreHeaders } from "../../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../../lib/api/log.js";
import { getCheck, getAgentResults, listEventsAfter } from "../../../../../lib/db/index.js";
import { AGENT_ORDER, AGENT_DISPLAY_NAMES } from "../../../../../lib/config/agents.js";
import { getSkippedGuidance } from "../../../../../lib/agents/activity.js";
import { env } from "../../../../../lib/env.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/checks/:id/agents
 *
 * Returns status, durationMs, summary, activity, flags, verified, unchecked,
 * and manualChecks for all six specialist agents in fixed canonical order.
 * Works seamlessly for checks that are created, running, or finished.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/api/checks/[id]/agents");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db } = runtimeDeps;

  try {
    // 1. Rate Limiting per IP
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    if (rateLimiters?.getCheck) {
      rateLimiters.getCheck.assertAllowed(clientKey);
    }

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

    // 4. Fetch stored agent results from DB
    const storedResults = getAgentResults(checkId, db);
    const resultsByAgent = new Map();
    for (const res of storedResults) {
      // If agent ran in multiple rounds, take latest round
      const existing = resultsByAgent.get(res.agent);
      if (!existing || (res.round || 0) >= (existing.round || 0)) {
        resultsByAgent.set(res.agent, res);
      }
    }

    // 5. Query check_events for live activity if check is in progress
    const checkStatus = check.status || "created";
    const isRunning = checkStatus === "investigating" || checkStatus === "scoring";
    let liveEventsByAgent = new Map();

    if (isRunning) {
      try {
        const eventRows = listEventsAfter(checkId, -1, db);
        for (const row of eventRows) {
          if (row.agent) {
            if (!liveEventsByAgent.has(row.agent)) {
              liveEventsByAgent.set(row.agent, []);
            }
            liveEventsByAgent.get(row.agent).push(row);
          }
        }
      } catch {
        // Fallback gracefully if event querying encounters an issue
      }
    }

    // 6. Build response for all six agents in AGENT_ORDER
    const cards = AGENT_ORDER.map((agentKey) => {
      const displayName = AGENT_DISPLAY_NAMES[agentKey] || agentKey;
      const stored = resultsByAgent.get(agentKey);

      if (stored) {
        let chipStatus = "done";
        if (stored.status === "skipped") {
          chipStatus = "not_applicable";
        } else if (stored.status === "could_not_check") {
          chipStatus = "could_not_check";
        } else if (Array.isArray(stored.flags) && stored.flags.length > 0) {
          chipStatus = "found_issues";
        }

        return {
          agent: agentKey,
          name: displayName,
          status: chipStatus,
          rawStatus: stored.status,
          durationMs: stored.durationMs || 0,
          summary: stored.summary || "",
          activity: Array.isArray(stored.activity) ? stored.activity : [],
          flags: Array.isArray(stored.flags) ? stored.flags : [],
          verified: Array.isArray(stored.verified) ? stored.verified : [],
          unchecked: Array.isArray(stored.unchecked) ? stored.unchecked : [],
          manualChecks: Array.isArray(stored.manualChecks) ? stored.manualChecks : [],
          trace: Array.isArray(stored.trace) ? stored.trace : [],
          entityStatus: Array.isArray(stored.entityStatus) ? stored.entityStatus : [],
        };
      }

      // Check has not produced a stored result for this agent yet
      let chipStatus = "waiting";
      let summary = "Waiting to begin verification.";
      const liveEvents = liveEventsByAgent.get(agentKey) || [];
      const liveActivity = [];

      for (const ev of liveEvents) {
        if (ev.type === "agent_status" && ev.status === "started") {
          chipStatus = "running";
          summary = "Running verification...";
        }
        if (ev.type === "activity") {
          if (ev.entry) {
            liveActivity.push(ev.entry);
          } else if (ev.payload_json) {
            try {
              const parsed = JSON.parse(ev.payload_json);
              if (parsed.entry) {
                liveActivity.push(parsed.entry);
              }
            } catch {}
          }
        }
      }

      if (!isRunning && checkStatus !== "awaiting_confirmation" && checkStatus !== "created") {
        if (checkStatus === "failed") {
          chipStatus = "could_not_check";
          summary = "Check halted due to pipeline error.";
        } else {
          chipStatus = "not_applicable";
          summary = getSkippedGuidance(agentKey);
        }
      }

      return {
        agent: agentKey,
        name: displayName,
        status: chipStatus,
        rawStatus: chipStatus === "running" ? "running" : "waiting",
        durationMs: 0,
        summary,
        activity: liveActivity,
        flags: [],
        verified: [],
        unchecked: [],
        manualChecks: [],
        trace: [],
        entityStatus: [],
      };
    });

    const res = Response.json(
      { agents: cards },
      {
        status: 200,
        headers: noStoreHeaders(),
      }
    );

    reqLogger.logResponse(200);
    return applySecurityHeaders(res);
  } catch (err) {
    const errorResponse = toResponse(err, noStoreHeaders());
    reqLogger.logError(err, errorResponse.status);
    return applySecurityHeaders(errorResponse);
  }
}

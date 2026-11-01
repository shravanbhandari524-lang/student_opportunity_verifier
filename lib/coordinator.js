/**
 * lib/coordinator.js
 *
 * Coordinator (Main Agent Orchestrator) for Layer L5:
 * - Single writer: only coordinator writes to SQLite / CaseFile.
 * - State machine enforcement: moves check from awaiting_confirmation -> investigating -> scoring -> report_ready (or failed).
 * - Multi-round agent execution loop (max 2 rounds):
 *     Round 1: runs all eligible agents concurrently via Promise.allSettled; records skipped for ineligible.
 *     Round 2: runs only if new entities were discovered in round 1; executes only newly eligible agents.
 * - Single-writer validation & sanitization:
 *     Validates AgentResult against AgentResultSchema; drops unverified flags or invalid entities.
 *     Enforces SSRF and 5-entity cap on discovered entities before adding to DB with source="discovered".
 * - Deterministic scoring & report writer integration:
 *     Calls pure scoreCase(), updates check result columns in DB.
 *     Calls generateReport(), saves report via saveReport(), transitions to report_ready.
 * - Never throws unhandled errors from agent execution; handles pipeline timeout cap cleanly.
 */

import { agents } from "./agents/index.js";
import { runAgent, limitNewEntities, verifyEvidence, getMessageText, getAnalysisText } from "./agents/base.js";
import { createActivityRecorder, ensureAgentActivityAndSummary } from "./agents/activity.js";
import { AgentResultSchema } from "./contracts/agent-result.js";
import { FLAG_REGISTRY, canEmit } from "./contracts/flags.js";
import { ProgressEventSchema } from "./contracts/events.js";
import { CandidateTraceEventSchema, truncateEventPayload } from "./contracts/trace.js";
import { instrumentTools } from "./trace.js";
import { getCaseFile } from "./caseFile.js";
import { scoreCase } from "./scoring/score.js";
import { generateReport } from "./report.js";
import {
  getDb,
  getCheck,
  updateStatus,
  updateCheckResult,
  saveRoundResults,
  appendEvent,
  saveReport,
} from "./db/index.js";
import { generate as defaultGenerate } from "./llm/generate.js";
import { classifyText as defaultClassify, classifierHealth as defaultClassifierHealth } from "./classifier.js";
import { search as defaultSearch } from "./tools/search.js";
import { fetchPage as defaultFetchPage } from "./tools/fetchPage.js";
import { lookup as defaultLookup } from "./graph.js";
import { logger as defaultLogger } from "./logger.js";
import { createRecordedGenerate, createRecordedSearch } from "./record-replay.js";

export const PIPELINE_TIMEOUT_MS = 60000;
export const MAX_ROUNDS = 2;
export const CHECK_SEARCH_BUDGET = 10;

/**
 * Builds standard production dependencies for investigation execution.
 * Keeps agents decoupled from direct database access by binding graphLookup.
 *
 * @param {object} [env=process.env]
 * @param {import("better-sqlite3").Database} [db]
 * @returns {object} Dependencies bundle
 */
export function buildDefaultDeps(env = process.env, db = getDb()) {
  const wrappedGenerate = createRecordedGenerate(defaultGenerate, { customEnv: env, logger: defaultLogger });
  const rawSearch = (query, opts) => defaultSearch(query, { ...opts, customEnv: env, db });
  const wrappedSearch = createRecordedSearch(rawSearch, { customEnv: env, logger: defaultLogger });

  return {
    generate: wrappedGenerate,
    classify: (text, opts) => defaultClassify(text, { ...opts, customEnv: env }),
    classifierHealth: (opts) => defaultClassifierHealth({ ...opts, customEnv: env }),
    search: wrappedSearch,
    readPage: defaultFetchPage,
    graphLookup: (kind, value) => defaultLookup(kind, value, { db }),
    now: () => Date.now(),
    logger: defaultLogger,
    db,
  };
}

/**
 * Validates, filters, and sanitizes an agent result before writing to database.
 * Drops unknown flag IDs, flags failing canEmit, flags without valid evidence, and non-conforming new entities.
 * Appends dropped counts to notes.
 *
 * @param {object} rawResult - Raw agent result candidate
 * @param {object} snapshot - Current case file snapshot
 * @returns {import("./contracts/agent-result.js").AgentResult}
 */
export function sanitizeAgentResult(rawResult, snapshot) {
  const checkId = snapshot?.check?.id || rawResult?.checkId || "00000000-0000-0000-0000-000000000000";
  const round = snapshot?.check?.currentRound || rawResult?.round || 1;
  const agentName = rawResult?.agent || "unknown_agent";
  const agentKind = rawResult?.kind || "agent";

  if (!rawResult || typeof rawResult !== "object") {
    return ensureAgentActivityAndSummary({
      checkId,
      agent: agentName,
      kind: agentKind,
      round,
      status: "could_not_check",
      reason: "invalid_agent_result",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Result was not an object",
      durationMs: 0,
    });
  }

  // If status is not ok (e.g. skipped, could_not_check), validate directly
  if (rawResult.status !== "ok") {
    const candidate = ensureAgentActivityAndSummary({
      checkId,
      ...rawResult,
    });
    const parseResult = AgentResultSchema.safeParse(candidate);
    if (parseResult.success) {
      return parseResult.data;
    }
    return ensureAgentActivityAndSummary({
      checkId,
      agent: agentName,
      kind: agentKind,
      round,
      status: "could_not_check",
      reason: rawResult.reason || "invalid_agent_result",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Result failed schema validation",
      durationMs: rawResult.durationMs || 0,
    });
  }

  // For status === "ok":
  // 1. Filter flags: must be in FLAG_REGISTRY, canEmit(flagId, agentName), and have verified evidence
  const analysisText = getAnalysisText(snapshot) || getMessageText(snapshot);
  const rawFlags = Array.isArray(rawResult.flags) ? rawResult.flags : [];
  let droppedFlagsCount = 0;

  const validFlags = rawFlags.filter((f) => {
    if (!f || typeof f !== "object") {
      droppedFlagsCount++;
      return false;
    }
    if (!FLAG_REGISTRY[f.id]) {
      droppedFlagsCount++;
      return false;
    }
    if (!canEmit(f.id, agentName)) {
      droppedFlagsCount++;
      return false;
    }
    if (!Array.isArray(f.evidence) || f.evidence.length === 0) {
      droppedFlagsCount++;
      return false;
    }
    const evidenceOk = f.evidence.every((ev) => verifyEvidence(ev, analysisText));
    if (!evidenceOk) {
      droppedFlagsCount++;
      return false;
    }
    return true;
  });

  // 2. Filter and cap newEntities (SSRF, normalization, deduplication, max 5)
  const existingKeys = new Set(
    (snapshot?.entities || []).map((e) => `${e.kind}:${e.value}`)
  );
  const rawNewEntities = Array.isArray(rawResult.newEntities) ? rawResult.newEntities : [];
  const { accepted: validNewEntities, droppedCount: droppedEntitiesCount } = limitNewEntities(rawNewEntities, {
    existingEntityKeys: existingKeys,
    agentName,
  });

  let notes = typeof rawResult.notes === "string" ? rawResult.notes : "";
  if (droppedFlagsCount > 0) {
    notes = notes ? `${notes}; dropped ${droppedFlagsCount} invalid flag(s)` : `dropped ${droppedFlagsCount} invalid flag(s)`;
  }
  if (droppedEntitiesCount > 0) {
    notes = notes ? `${notes}; dropped ${droppedEntitiesCount} entity candidate(s)` : `dropped ${droppedEntitiesCount} entity candidate(s)`;
  }

  const candidate = ensureAgentActivityAndSummary({
    ...rawResult,
    checkId,
    flags: validFlags,
    newEntities: validNewEntities,
    processedEntities: Array.isArray(rawResult.processedEntities) ? rawResult.processedEntities : [],
    verified: Array.isArray(rawResult.verified) ? rawResult.verified : [],
    unchecked: Array.isArray(rawResult.unchecked) ? rawResult.unchecked : [],
    manualChecks: Array.isArray(rawResult.manualChecks) ? rawResult.manualChecks : [],
    trace: Array.isArray(rawResult.trace) ? rawResult.trace : [],
    notes,
    durationMs: typeof rawResult.durationMs === "number" ? rawResult.durationMs : 0,
  });

  const parseResult = AgentResultSchema.safeParse(candidate);
  if (!parseResult.success) {
    return ensureAgentActivityAndSummary({
      checkId,
      agent: agentName,
      kind: agentKind,
      round,
      status: "could_not_check",
      reason: "invalid_agent_result",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Result failed schema validation",
      durationMs: candidate.durationMs,
    });
  }

  return parseResult.data;
}

/**
 * Emits an event both to SQLite check_events log and safely to deps.onEvent.
 *
 * @param {string} checkId
 * @param {object} eventCandidate
 * @param {import("better-sqlite3").Database} db
 * @param {Function} [onEvent]
 * @param {number} [round]
 */
function emitProgressEvent(checkId, eventCandidate, db, onEvent, round = null) {
  // 1. Append to SQLite check_events (allows type, round, agent, status, summary)
  const dbEventRow = {
    round: eventCandidate.round ?? round ?? null,
    type: eventCandidate.type,
    agent: eventCandidate.agent ?? null,
    status: eventCandidate.status ?? null,
    summary: eventCandidate.summary ?? null,
  };
  appendEvent(checkId, dbEventRow, db);

  // 2. Safely call onEvent if provided and event strictly conforms to ProgressEventSchema
  if (typeof onEvent === "function") {
    try {
      // Shape the event strictly for ProgressEventSchema
      let progressEvent = null;
      if (eventCandidate.type === "stage" && eventCandidate.stage) {
        progressEvent = { type: "stage", stage: eventCandidate.stage };
      } else if (eventCandidate.type === "round" && eventCandidate.round && eventCandidate.status) {
        progressEvent = { type: "round", round: eventCandidate.round, status: eventCandidate.status };
      } else if (eventCandidate.type === "agent" && eventCandidate.round && eventCandidate.agent && eventCandidate.status) {
        progressEvent = { type: "agent", round: eventCandidate.round, agent: eventCandidate.agent, status: eventCandidate.status };
      } else if (eventCandidate.type === "complete" && eventCandidate.riskLevel) {
        progressEvent = { type: "complete", riskLevel: eventCandidate.riskLevel };
      } else if (eventCandidate.type === "error" && eventCandidate.code && eventCandidate.message) {
        progressEvent = { type: "error", code: eventCandidate.code, message: eventCandidate.message };
      }

      if (progressEvent) {
        const parsed = ProgressEventSchema.safeParse(progressEvent);
        if (parsed.success) {
          onEvent(parsed.data);
        }
      }
    } catch {
      // Never crash the pipeline if caller's onEvent throws
    }
  }
}

/**
 * Orchestrates a complete opportunity investigation pipeline.
 *
 * Lifecycle:
 * 1. Checks start status (must be awaiting_confirmation; or investigating with resume: true).
 * 2. Transitions to investigating.
 * 3. Enforces shared search budget across all agents in check run.
 * 4. Multi-round agent execution loop (max 2 rounds):
 *    - In round 1: runs all eligible agents; records skipped for ineligible.
 *    - In round 2: runs only agents newly eligible on discovered entities.
 * 5. Atomically saves results, new entities, and events via saveRoundResults.
 * 6. Drops late results if pipeline timeout budget is exceeded.
 * 7. Transitions to scoring, runs pure scoreCase, updates check score columns.
 * 8. Generates report via generateReport, saves report, transitions to report_ready.
 *
 * @param {string} checkId - UUID of the check
 * @param {object} [deps] - Injected dependencies
 * @param {object} [options] - Execution options { pipelineTimeoutMs, resume, searchBudget }
 * @returns {Promise<object>} Generated report, or failure object on unrecoverable error
 */
export async function runInvestigation(checkId, deps = {}, options = {}) {
  const db = deps.db || getDb();
  const pipelineTimeoutMs = options.pipelineTimeoutMs ?? PIPELINE_TIMEOUT_MS;
  const maxSearchBudget = options.searchBudget ?? CHECK_SEARCH_BUDGET;
  const onEvent = deps.onEvent;
  const isResume = Boolean(options.resume || deps.resume);

  const initialCheck = getCheck(checkId, db);
  if (!initialCheck) {
    throw new Error(`Check not found: ${checkId}`);
  }

  // State machine validation: must be awaiting_confirmation (or investigating with resume: true)
  if (initialCheck.status === "investigating") {
    if (!isResume) {
      throw new Error(
        `Cannot start investigation from status 'investigating' without resume option.`
      );
    }
  } else if (initialCheck.status !== "awaiting_confirmation") {
    throw new Error(
      `Cannot start investigation from status '${initialCheck.status}'. Expected 'awaiting_confirmation'.`
    );
  }

  // Transition to investigating if not already there
  if (initialCheck.status !== "investigating") {
    updateStatus(checkId, "investigating", db);
  }

  const startTime = Date.now();
  let timedOut = false;
  const isPipelineExpired = () => Date.now() - startTime >= pipelineTimeoutMs;

  const logger = deps.logger || defaultLogger;

  /**
   * Coordinator emit function:
   * Truncates oversized fields, validates against CandidateTraceEventSchema,
   * assigns seq atomically and persists via appendEvent, and broadcasts
   * the stored TraceEvent to onEvent and eventBus subscribers.
   * Dropped invalid events are logged without payload.
   * NEVER throws.
   *
   * @param {object} candidate
   * @returns {object|null} The stored TraceEvent, or null if dropped
   */
  function emit(candidate) {
    try {
      if (!candidate || typeof candidate !== "object") return null;

      const raw = {
        checkId,
        ts: candidate.ts || new Date().toISOString(),
        round: candidate.round ?? 0,
        agent: candidate.agent ?? null,
        ...candidate,
      };

      // 1. Truncate oversized fields (enforce 4 KB limit)
      const truncated = truncateEventPayload(raw);

      // 2. Validate against CandidateTraceEventSchema (before seq assignment)
      const parseRes = CandidateTraceEventSchema.safeParse(truncated);
      if (!parseRes.success) {
        if (logger?.warn) {
          logger.warn({ checkId, event: "trace_event_dropped", type: candidate.type });
        }
        return null;
      }

      // 3. Atomically persist via appendEvent (assigns monotonic seq)
      const storedEvent = appendEvent(checkId, parseRes.data, db);

      // 4. Broadcast the stored TraceEvent to subscribers
      if (typeof onEvent === "function") {
        try {
          onEvent(storedEvent);
        } catch {
          // Never crash if caller's onEvent throws
        }
      }

      if (deps.eventBus && typeof deps.eventBus.notify === "function") {
        try {
          deps.eventBus.notify(checkId, storedEvent);
        } catch {
          // Guard event bus errors
        }
      }

      return storedEvent;
    } catch (err) {
      if (logger?.error) {
        logger.error({ checkId, event: "trace_emit_failed", message: err?.message || String(err) });
      }
      return null;
    }
  }

  emit({
    type: "stage",
    stage: "investigating",
    round: 1,
  });

  // Shared search budget counter for this check execution
  let searchCallCount = 0;
  const rawSearch = deps.search || defaultSearch;
  const budgetedSearch = async (query, searchOpts = {}) => {
    if (isPipelineExpired()) {
      return {
        ok: false,
        error: {
          code: "BUDGET_EXCEEDED",
          message: "Pipeline execution budget exceeded; search refused",
        },
      };
    }
    searchCallCount++;
    if (searchCallCount > maxSearchBudget) {
      return {
        ok: false,
        error: {
          code: "BUDGET_EXCEEDED",
          message: `Search budget of ${maxSearchBudget} exceeded for check`,
        },
      };
    }
    return rawSearch(query, { ...searchOpts, customEnv: process.env, db });
  };

  const agentDeps = {
    ...deps,
    search: budgetedSearch,
    now: () => Date.now(),
  };

  try {
    for (let currentRound = 1; currentRound <= MAX_ROUNDS; currentRound++) {
      if (isPipelineExpired()) {
        timedOut = true;
        break;
      }

      // Update check's current round in database
      updateCheckResult(checkId, { currentRound }, db);

      emit({
        type: "round",
        round: currentRound,
      });

      // Take latest snapshot of the case file
      const snapshot = getCaseFile(checkId, db);

      // Determine which agents to run in this round
      const eligibleAgents = [];
      const skippedResultsToSave = [];

      const agentList = Array.isArray(deps.agents) ? deps.agents : agents;
      for (const agent of agentList) {
        let isEligible = false;
        try {
          isEligible = typeof agent.canRun === "function" && agent.canRun(snapshot);
        } catch {
          // If canRun itself throws, record as could_not_check
          const failedCandidate = ensureAgentActivityAndSummary({
            checkId,
            agent: agent.name,
            kind: agent.kind || "agent",
            round: currentRound,
            status: "could_not_check",
            reason: "can_run_threw",
            flags: [],
            verified: [],
            newEntities: [],
            processedEntities: [],
            unchecked: [],
            manualChecks: [],
            trace: [],
            notes: "canRun evaluation threw an unexpected error",
            durationMs: 0,
          });
          saveRoundResults(checkId, {
            result: failedCandidate,
            events: [],
          }, db);
          if (failedCandidate.activity?.[0]) {
            emit({
              type: "activity",
              agent: agent.name,
              round: currentRound,
              entry: failedCandidate.activity[0],
            });
          }
          emit({
            type: "agent_status",
            round: currentRound,
            agent: agent.name,
            status: "could_not_check",
            summary: failedCandidate.summary || "Eligibility evaluation threw an exception",
          });
          continue;
        }

        if (isEligible) {
          eligibleAgents.push(agent);
        } else if (currentRound === 1) {
          // In Round 1, record skipped results for ineligible agents
          const reason =
            typeof agent.skippedReason === "function"
              ? agent.skippedReason(snapshot)
              : "no_applicable_input";

          skippedResultsToSave.push({
            agent: agent.name,
            kind: agent.kind || "agent",
            round: currentRound,
            status: "skipped",
            reason,
            flags: [],
            verified: [],
            newEntities: [],
            processedEntities: [],
            unchecked: [],
            manualChecks: [],
            trace: [],
            notes: "",
            durationMs: 0,
          });
        }
        // Note: In round 2, ineligible agents are not written as skipped per ARCHITECTURE §3.7
      }

      // Save skipped results atomically for Round 1
      for (const skipped of skippedResultsToSave) {
        const enrichedSkipped = ensureAgentActivityAndSummary({
          checkId,
          ...skipped,
        });
        saveRoundResults(checkId, {
          result: enrichedSkipped,
          events: [],
        }, db);
        if (enrichedSkipped.activity?.[0]) {
          emit({
            type: "activity",
            agent: skipped.agent,
            round: currentRound,
            entry: enrichedSkipped.activity[0],
          });
        }
        emit({
          type: "agent_status",
          round: currentRound,
          agent: skipped.agent,
          status: "skipped",
          summary: enrichedSkipped.summary || `Skipped: ${skipped.reason}`,
        });
      }

      // If no eligible agents to run in this round, round finishes
      if (eligibleAgents.length === 0) {
        break;
      }

      // Emit started event for each running agent
      for (const ag of eligibleAgents) {
        emit({
          type: "agent_status",
          round: currentRound,
          agent: ag.name,
          status: "started",
          summary: `Agent ${ag.name} started in round ${currentRound}`,
        });
      }

      // Run eligible agents in parallel with instrumented tools and ctx
      const remainingTime = Math.max(10, pipelineTimeoutMs - (Date.now() - startTime));
      const agentTimeout = Math.min(25000, remainingTime);

      const agentTools = {
        search: budgetedSearch,
        readPage: deps.readPage,
        fetchPage: deps.fetchPage || deps.readPage,
        rdapLookup: deps.rdapLookup,
        dnsRecords: deps.dnsRecords,
        sslInfo: deps.sslInfo,
        waybackFirstSeen: deps.waybackFirstSeen,
        lookalikeCheck: deps.lookalikeCheck,
        classify: deps.classify,
        classifier: deps.classify,
        classifierHealth: deps.classifierHealth,
        payments: deps.payments,
        graphLookup: deps.graphLookup,
        youtubeComments: deps.youtubeComments,
        urlhaus: deps.urlhaus,
        safeBrowsing: deps.urlhaus,
        urlscanSearch: deps.urlscanSearch,
        urlscan: deps.urlscanSearch,
      };

      let newlyAddedEntitiesInRound = 0;
      let writeQueue = Promise.resolve();

      const handleAgentSettled = (ag, resOutcome) => {
        writeQueue = writeQueue.then(async () => {
          let agentResult;
          if (isPipelineExpired()) {
            timedOut = true;
            if (resOutcome.status === "fulfilled" && resOutcome.value?.status === "could_not_check" && resOutcome.value?.reason === "timeout") {
              agentResult = {
                ...resOutcome.value,
                reason: "pipeline_timeout",
                notes: "Agent timed out under pipeline timeout budget",
              };
            } else if (resOutcome.status !== "fulfilled") {
              agentResult = {
                checkId,
                agent: ag.name,
                kind: ag.kind || "agent",
                round: currentRound,
                status: "could_not_check",
                reason: "pipeline_timeout",
                flags: [],
                verified: [],
                newEntities: [],
                processedEntities: [],
                unchecked: [],
                manualChecks: [],
                trace: [],
                notes: "Agent aborted due to overall pipeline timeout",
                durationMs: 0,
              };
            } else {
              agentResult = resOutcome.value;
            }
          } else if (resOutcome.status === "fulfilled") {
            agentResult = resOutcome.value;
          } else {
            agentResult = {
              checkId,
              agent: ag.name,
              kind: ag.kind || "agent",
              round: currentRound,
              status: "could_not_check",
              reason: "unhandled_rejection",
              flags: [],
              verified: [],
              newEntities: [],
              processedEntities: [],
              unchecked: [],
              manualChecks: [],
              trace: [],
              notes: String(resOutcome.reason?.message || resOutcome.reason),
              durationMs: 0,
            };
          }

          // Fetch fresh snapshot so newly discovered entities from earlier agents in this round are known
          const currentSnapshot = getCaseFile(checkId, db);
          const sanitized = sanitizeAgentResult(agentResult, currentSnapshot);

          // Discovered entities candidate list
          const entitiesToSave = [];
          if (sanitized.status === "ok" && Array.isArray(sanitized.newEntities)) {
            for (const newEnt of sanitized.newEntities) {
              entitiesToSave.push({
                ...newEnt,
                source: "discovered",
                discoveredBy: ag.name,
                round: currentRound,
                confirmed: false,
              });
            }
          }

          // Save result and discovered entities atomically
          const roundSaveOutcome = saveRoundResults(checkId, {
            result: sanitized,
            newEntities: entitiesToSave,
            events: [],
          }, db);

          newlyAddedEntitiesInRound += roundSaveOutcome.addedEntitiesCount;

          // Coordinator emits in strict order per agent: flag, entity, agent_status done
          if (sanitized.status === "ok") {
            if (Array.isArray(sanitized.flags)) {
              for (const flg of sanitized.flags) {
                emit({
                  type: "flag",
                  agent: ag.name,
                  round: currentRound,
                  flagId: flg.id,
                  title: flg.title,
                  severity: flg.severity,
                  evidence: Array.isArray(flg.evidence) ? flg.evidence : [],
                });
              }
            }

            for (const ent of entitiesToSave) {
              emit({
                type: "entity",
                agent: ag.name,
                round: currentRound,
                kind: ent.kind,
                value: ent.value,
                evidence: typeof ent.evidence === "string" ? ent.evidence : (ent.evidence?.value || ""),
              });
            }
          }

          const statusForEvent = sanitized.status === "ok" ? "done" : sanitized.status;
          emit({
            type: "agent_status",
            round: currentRound,
            agent: ag.name,
            status: statusForEvent,
            summary: sanitized.notes || sanitized.reason || `Agent ${ag.name} finished with status ${statusForEvent}`,
          });
        });
        return writeQueue;
      };

      const runPromises = eligibleAgents.map((ag) => {
        const instrumented = instrumentTools(
          agentTools,
          (cand) => emit({ ...cand, round: currentRound, agent: ag.name }),
          ag.name,
          currentRound
        );

        const ctx = {
          tools: instrumented,
          note: (text) => {
            emit({
              type: "note",
              agent: ag.name,
              round: currentRound,
              text: String(text || "").slice(0, 80),
            });
          },
          verdict: (claim, verdict, sources = []) => {
            emit({
              type: "verdict",
              agent: ag.name,
              round: currentRound,
              claim: String(claim || "").slice(0, 150),
              verdict,
              sources: Array.isArray(sources) ? sources.map(String) : [String(sources)],
            });
          },
        };

        const specificAgentDeps = {
          ...agentDeps,
          ...instrumented,
          ctx,
        };

        const agentPromise = runAgent(ag, snapshot, specificAgentDeps, { timeoutMs: agentTimeout });
        return agentPromise.then(
          (result) => handleAgentSettled(ag, { status: "fulfilled", value: result }),
          (err) => handleAgentSettled(ag, { status: "rejected", reason: err })
        );
      });

      await Promise.allSettled(runPromises);
      await writeQueue;

      // Determine if Round 2 should proceed:
      // Only proceed if round 1 just completed, new entities were successfully added, and pipeline has not expired
      if (currentRound === 1 && (newlyAddedEntitiesInRound === 0 || isPipelineExpired() || timedOut)) {
        break;
      }
    }

    // -----------------------------------------------------------------
    // STAGE: SCORING
    // -----------------------------------------------------------------
    updateStatus(checkId, "scoring", db);
    emit({
      type: "stage",
      stage: "scoring",
    });

    const postRoundSnapshot = getCaseFile(checkId, db);

    // Extract classifierMaxPoints from classifier_client trace (if present)
    let classifierMaxPoints = 25;
    const clfFinding = (postRoundSnapshot.findings || []).find(
      (f) => f && f.agent === "classifier_client" && f.status === "ok"
    );
    if (clfFinding) {
      const healthTrace = Array.isArray(clfFinding.trace)
        ? clfFinding.trace.find((t) => typeof t?.classifierMaxPoints === "number")
        : null;
      if (healthTrace) {
        classifierMaxPoints = healthTrace.classifierMaxPoints;
      }
    }

    const scoreResult = scoreCase(postRoundSnapshot, { classifierMaxPoints });

    // Update check record with final risk level, score, and confidence
    updateCheckResult(checkId, {
      riskLevel: scoreResult.level,
      score: scoreResult.score,
      confidence: scoreResult.confidence,
    }, db);

    // -----------------------------------------------------------------
    // STAGE: REPORT WRITER
    // -----------------------------------------------------------------
    emit({
      type: "stage",
      stage: "report",
    });

    // Build metadata-only summary for report prompt (counts and entity kinds only; NO raw user text)
    const textInputsCount = postRoundSnapshot.inputs.filter((i) => i.type === "text").length;
    const imageInputsCount = postRoundSnapshot.inputs.filter((i) => i.type === "image").length;
    const entityKinds = Array.from(new Set(postRoundSnapshot.entities.map((e) => e.kind)));
    const checkInputsSummary = `User submission contains ${textInputsCount} text block(s), ${imageInputsCount} screenshot image(s). Entities extracted: ${entityKinds.join(", ") || "none"}.`;

    const reportDeps = {
      ...deps,
      now: () => new Date().toISOString(),
    };
    const report = await generateReport({
      findings: postRoundSnapshot.findings,
      scoreResult,
      language: postRoundSnapshot.check.language,
      checkInputsSummary,
    }, reportDeps);

    // Save report to database
    saveReport(checkId, report, db);

    // -----------------------------------------------------------------
    // STAGE: REPORT READY (TERMINAL)
    // -----------------------------------------------------------------
    updateStatus(checkId, "report_ready", db);
    emit({
      type: "stage",
      stage: "report_ready",
    });

    emit({
      type: "complete",
    });

    return report;
  } catch (err) {
    // Unrecoverable pipeline error: update status to failed safely without rethrowing
    try {
      updateCheckResult(checkId, {
        status: "failed",
        failureReason: "coordinator_pipeline_error",
      }, db);
      emit({
        type: "agent_status",
        status: "could_not_check",
        summary: `Investigation failed: ${err?.message || String(err)}`,
      });
    } catch {
      // Ignore secondary error while attempting failure update
    }
    return {
      checkId,
      status: "failed",
      reason: "coordinator_pipeline_error",
    };
  }
}


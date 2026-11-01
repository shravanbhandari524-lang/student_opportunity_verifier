import { logger as defaultLogger } from "../logger.js";
import { listStaleChecks, markCheckFailed } from "../db/index.js";
import { apiError } from "./errors.js";

/**
 * Background job runner tracking active concurrent investigations.
 * Rejects new tasks with HTTP 503 SERVICE_UNAVAILABLE when capacity is reached.
 *
 * @param {object} [options]
 * @param {number} [options.maxConcurrent=4]
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 * @returns {{
 *   run: (checkId: string, taskFn: () => Promise<void>) => Promise<void>,
 *   activeCount: () => number,
 *   isActive: (checkId: string) => boolean,
 *   waitForAll: (timeoutMs?: number) => Promise<boolean>
 * }}
 */
export function createJobRunner(options = {}) {
  const maxConcurrent = options.maxConcurrent ?? 4;
  const logger = options.logger || defaultLogger;
  const activeJobs = options.activeJobs || new Map();

  async function run(checkId, taskFn) {
    if (activeJobs.has(checkId)) {
      // Already running for this checkId
      return activeJobs.get(checkId);
    }

    if (activeJobs.size >= maxConcurrent) {
      throw apiError(
        "SERVICE_UNAVAILABLE",
        "Server is busy processing other checks. Please try again shortly.",
        503,
        { activeJobs: activeJobs.size, maxConcurrent }
      );
    }

    const promise = (async () => {
      try {
        await taskFn();
      } catch (err) {
        logger.error({ checkId, err: err?.message || String(err) }, "Background job failed unhandled");
      } finally {
        activeJobs.delete(checkId);
      }
    })();

    activeJobs.set(checkId, promise);
    return promise;
  }

  function activeCount() {
    return activeJobs.size;
  }

  function isActive(checkId) {
    return activeJobs.has(checkId);
  }

  async function waitForAll(timeoutMs = 5000) {
    const promises = Array.from(activeJobs.values());
    if (promises.length === 0) return true;

    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
    const allDonePromise = Promise.all(promises).then(() => true);

    return Promise.race([allDonePromise, timeoutPromise]);
  }

  return {
    run,
    activeCount,
    isActive,
    waitForAll,
  };
}

/**
 * Recovers stale checks that were left in intermediate states (extracting, investigating, scoring)
 * when a server process was terminated or restarted.
 *
 * Marks them as "failed" using the repository updateStatus function.
 *
 * @param {object} deps
 * @param {import("better-sqlite3").Database} deps.db
 * @param {() => number} [deps.now]
 * @param {number} [deps.maxAgeMs=300000] Default 5 minutes
 * @param {object} [deps.logger]
 * @returns {{ recoveredCount: number, checkIds: string[] }}
 */
export function recoverStaleChecks(deps) {
  const db = deps.db;
  if (!db) {
    throw new Error("db is required for recoverStaleChecks");
  }
  const now = deps.now ? deps.now() : Date.now();
  const maxAgeMs = deps.maxAgeMs ?? 300000;
  const logger = deps.logger || defaultLogger;

  const cutoffIso = new Date(now - maxAgeMs).toISOString();

  // Find candidate checks that are stuck in intermediate statuses and updated before cutoff
  const staleRows = listStaleChecks(
    ["extracting", "investigating", "scoring"],
    maxAgeMs,
    now,
    db
  );
  const recoveredIds = [];

  for (const row of staleRows) {
    try {
      markCheckFailed(row.id, "server_restart", {
        summary: "Server restarted during investigation",
        db,
      });
      recoveredIds.push(row.id);
      logger.warn({ checkId: row.id, previousStatus: row.status }, "Recovered stale check to failed");
    } catch (err) {
      logger.error({ checkId: row.id, err: err?.message }, "Failed to recover stale check");
    }
  }

  return {
    recoveredCount: recoveredIds.length,
    checkIds: recoveredIds,
  };
}


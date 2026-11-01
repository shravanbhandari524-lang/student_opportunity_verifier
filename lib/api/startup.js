/**
 * lib/api/startup.js
 *
 * Background tasks lifecycle and server initialization:
 * - Runs recoverStaleChecks once on startup to clean up orphan in-progress checks from prior crash/restart.
 * - Runs runCleanup once on startup to delete expired checks and orphan files.
 * - Schedules recurring runCleanup with an unref'd timer (default interval: 1 hour = 3600000 ms).
 * - Idempotent: multiple calls return the same running state and do not create duplicate intervals.
 * - Fault isolated: every sub-step is wrapped in try/catch and logged with structured error codes without throwing.
 * - Exported stop() method to cleanly stop the background timer.
 */

import { recoverStaleChecks } from "./jobs.js";
import { runCleanup } from "../cleanup.js";
import { logger as defaultLogger } from "../logger.js";
import { env } from "../env.js";

const STARTUP_TASK_STATE = Symbol.for("APP_STARTUP_TASK_STATE");

/**
 * Starts operational background tasks (recovery + periodic cleanup).
 *
 * @param {object} [options={}]
 * @param {object} [options.runtime]
 * @param {() => number} [options.now]
 * @param {object} [options.logger]
 * @param {(fn: () => void, ms: number) => any} [options.setIntervalFn]
 * @param {(timer: any) => void} [options.clearIntervalFn]
 * @param {number} [options.intervalMs=3600000]
 * @returns {Promise<{ stop: () => void, started: boolean }>}
 */
export async function startBackgroundTasks(options = {}) {
  // Idempotency check via process-level / global state
  if (globalThis[STARTUP_TASK_STATE]) {
    return {
      stop: globalThis[STARTUP_TASK_STATE].stop,
      started: false,
    };
  }

  const logger = options.logger || defaultLogger;
  const runtime = options.runtime;
  const db = runtime?.db;
  const now = options.now || (() => Date.now());
  const intervalMs = options.intervalMs ?? 3600000;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;

  // Log active record/replay mode at startup
  logger.info(
    { code: "RECORD_REPLAY_STARTUP", mode: env.RECORD_REPLAY_MODE || "off" },
    `Record-replay mode active: ${env.RECORD_REPLAY_MODE || "off"}`
  );

  // 1. Recover stale checks (in extracting, investigating, scoring updated before crash/cutoff)
  try {
    const recoveryResult = recoverStaleChecks({
      db,
      now: typeof now === "function" ? now : () => now,
      logger,
    });
    logger.info(
      { code: "STARTUP_RECOVERY_SUCCESS", recoveredCount: recoveryResult.recoveredCount },
      "Startup recovery completed"
    );
  } catch (err) {
    logger.error(
      { code: "STARTUP_RECOVERY_ERROR", err: err?.message },
      "Startup recovery failed (continuing)"
    );
  }

  // 2. Run initial cleanup pass
  const uploadDir = options.uploadDir || env.UPLOAD_DIR || "./uploads";
  try {
    const cleanupResult = await runCleanup({
      db,
      now,
      logger,
      uploadDir,
    });
    logger.info(
      {
        code: "STARTUP_CLEANUP_SUCCESS",
        checksDeleted: cleanupResult.checksDeleted,
        filesDeleted: cleanupResult.filesDeleted,
      },
      "Initial startup cleanup completed"
    );
  } catch (err) {
    logger.error(
      { code: "STARTUP_CLEANUP_ERROR", err: err?.message },
      "Initial startup cleanup failed (continuing)"
    );
  }

  // 3. Schedule recurring hourly cleanup with unref'd timer
  let timerId = null;
  const timer = setIntervalFn(async () => {
    try {
      await runCleanup({ db, now, logger, uploadDir });
      logger.info({ code: "HOURLY_CLEANUP_SUCCESS" }, "Hourly background cleanup completed");
    } catch (err) {
      logger.error({ code: "HOURLY_CLEANUP_ERROR", err: err?.message }, "Hourly background cleanup error");
    }
  }, intervalMs);

  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }
  timerId = timer;

  const stop = () => {
    if (timerId !== null) {
      clearIntervalFn(timerId);
      timerId = null;
    }
    delete globalThis[STARTUP_TASK_STATE];
  };

  const handle = { stop, started: true };
  globalThis[STARTUP_TASK_STATE] = handle;
  return handle;
}

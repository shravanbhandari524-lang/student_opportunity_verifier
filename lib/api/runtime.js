import { getDb } from "../db/index.js";
import { logger as defaultLogger } from "../logger.js";
import { env } from "../env.js";
import { createRateLimiter } from "./rate-limit.js";
import { createJobRunner } from "./jobs.js";
import { eventBus as defaultEventBus } from "./event-bus.js";

const GLOBAL_RUNTIME_KEY = Symbol.for("OPP_VERIFIER_RUNTIME_INSTANCE");
let runtimeInstance = null;

/**
 * Initializes or returns the shared API runtime dependencies.
 * Survives Next.js dev server hot reload via globalThis.
 *
 * @param {object} [overrides]
 * @returns {{
 *   db: import("better-sqlite3").Database,
 *   logger: object,
 *   rateLimiters: {
 *     createCheck: ReturnType<typeof createRateLimiter>,
 *     confirmCheck: ReturnType<typeof createRateLimiter>,
 *     getCheck: ReturnType<typeof createRateLimiter>,
 *     globalDaily: ReturnType<typeof createRateLimiter>
 *   },
 *   jobRunner: ReturnType<typeof createJobRunner>,
 *   eventBus: typeof defaultEventBus
 * }}
 */
export function getRuntime(overrides = {}) {
  if (Object.keys(overrides).length === 0) {
    if (!env.IS_TEST && globalThis[GLOBAL_RUNTIME_KEY]) {
      return globalThis[GLOBAL_RUNTIME_KEY];
    }
    if (runtimeInstance) {
      return runtimeInstance;
    }
  }

  const db = overrides.db || getDb();
  const logger = overrides.logger || defaultLogger;
  const eventBus = overrides.eventBus || defaultEventBus;

  // Rate limiters per DR-6 & configurable envs
  const windowMs = Number(env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
  const rateLimiters = overrides.rateLimiters || {
    // POST /api/checks: Max requests per window
    createCheck: createRateLimiter({
      windowMs,
      max: Number(env.RATE_LIMIT_CREATE_MAX) || 10,
    }),
    // POST /api/checks/:id/confirm: Max requests per window
    confirmCheck: createRateLimiter({
      windowMs,
      max: Number(env.RATE_LIMIT_CONFIRM_MAX) || 10,
    }),
    // GET /api/checks/:id & /report: Max requests per window
    getCheck: createRateLimiter({
      windowMs: 60 * 1000,
      max: Number(env.RATE_LIMIT_READ_MAX) || 60,
    }),
    // GET /api/checks/:id/stream: Max stream connections per window
    streamCheck: createRateLimiter({
      windowMs: 60 * 1000,
      max: Number(env.RATE_LIMIT_STREAM_MAX) || 10,
    }),
    // POST /api/checks/:id/feedback & other action routes: Max requests per window
    actionCheck: createRateLimiter({
      windowMs,
      max: Number(env.RATE_LIMIT_ACTION_MAX) || 15,
    }),
    // GET /api/guides: Max guide reads per window
    guideRead: createRateLimiter({
      windowMs: 60 * 1000,
      max: Number(env.RATE_LIMIT_GUIDE_MAX) || 60,
    }),
    // Global daily check cap (across all IPs)
    globalDaily: createRateLimiter({
      windowMs: 24 * 60 * 60 * 1000,
      max: Number(env.GLOBAL_DAILY_CHECK_CAP) || 500,
    }),
  };

  const jobRunner = overrides.jobRunner || createJobRunner({
    maxConcurrent: Number(env.MAX_CONCURRENT_INVESTIGATIONS) || 4,
    logger,
  });

  const crawlJobRunner = overrides.crawlJobRunner || createJobRunner({
    maxConcurrent: Number(env.CRAWL_MAX_CONCURRENT) || 1,
    logger,
  });

  // Semaphore bounding concurrent check creates holding multipart body buffers
  let activeCreates = 0;
  const maxConcurrentCreates = Number(env.MAX_CONCURRENT_CREATES) || 2;
  const createSemaphore = overrides.createSemaphore || {
    acquire() {
      if (activeCreates >= maxConcurrentCreates) {
        return false;
      }
      activeCreates++;
      return true;
    },
    release() {
      if (activeCreates > 0) activeCreates--;
    },
    getActiveCount() {
      return activeCreates;
    },
    getMax() {
      return maxConcurrentCreates;
    },
  };

  const runtime = {
    db,
    logger,
    rateLimiters,
    jobRunner,
    crawlJobRunner,
    eventBus,
    createSemaphore,
    pipelineDeps: overrides.pipelineDeps || null,
  };

  if (Object.keys(overrides).length === 0) {
    runtimeInstance = runtime;
    if (!env.IS_TEST) {
      globalThis[GLOBAL_RUNTIME_KEY] = runtime;
    }
  }


  return runtime;
}

/**
 * Injects mock/test runtime dependencies for testing.
 *
 * @param {object} mockRuntime
 */
export function setRuntimeForTests(mockRuntime) {
  runtimeInstance = mockRuntime;
  globalThis[GLOBAL_RUNTIME_KEY] = mockRuntime;
}

/**
 * Resets the runtime singleton.
 */
export function resetRuntime() {
  runtimeInstance = null;
  delete globalThis[GLOBAL_RUNTIME_KEY];
}

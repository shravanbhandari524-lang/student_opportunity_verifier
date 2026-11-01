/**
 * lib/cleanup.js
 *
 * Maintenance and cleanup service for Layer L5:
 * - deleteExpired: purges checks older than 24h along with cascading children (inputs, entities, results, events, reports)
 *   while preserving graph nodes, graph edges, and setting feedback.check_id = NULL.
 * - purgeCache: removes expired lookup_cache rows.
 * - removes orphan files in the uploads directory that are not referenced in check_inputs.
 * - removes old image files exceeding MAX_IMAGE_AGE_MS (e.g. 1 hour) even if referenced, clearing file_path in DB.
 * - path containment guard: strictly refuses any file path that resolves outside the upload directory.
 * - fault isolation: never throws unhandled errors; records any sub-step error in `errors` array.
 */

import fs from "node:fs";
import path from "node:path";
import { getDb, deleteExpired, purgeCache, clearInputFile, listStaleChecks, markCheckFailed, markStaleCrawlsFailed } from "./db/index.js";
import { logger as defaultLogger } from "./logger.js";

export const MAX_IMAGE_AGE_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_STALE_INVESTIGATION_AGE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Runs the database and storage cleanup routine.
 *
 * @param {object} [deps={}]
 * @param {import("better-sqlite3").Database} [deps.db]
 * @param {() => number} [deps.now]
 * @param {(dir: string) => string[]} [deps.listFiles]
 * @param {(filePath: string) => void} [deps.unlink]
 * @param {object} [deps.logger]
 * @param {string} [deps.uploadDir]
 * @param {number} [deps.maxImageAgeMs]
 * @returns {Promise<{
 *   checksDeleted: number,
 *   cacheRowsPurged: number,
 *   filesDeleted: number,
 *   errors: string[]
 * }>}
 */
export async function runCleanup(deps = {}) {
  const db = deps.db || getDb();
  const nowFn = deps.now || (() => Date.now());
  const listFilesFn = deps.listFiles || ((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []));
  const unlinkFn = deps.unlink || ((filePath) => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
  const logger = deps.logger || defaultLogger;
  const uploadDir = deps.uploadDir || "./uploads";
  const maxImageAgeMs = deps.maxImageAgeMs ?? MAX_IMAGE_AGE_MS;
  const staleInvestigationAgeMs = deps.staleInvestigationAgeMs ?? DEFAULT_STALE_INVESTIGATION_AGE_MS;

  const resolvedUploadDir = path.resolve(uploadDir);
  const errors = [];
  let checksDeleted = 0;
  let cacheRowsPurged = 0;
  let filesDeleted = 0;
  let staleChecksRecovered = 0;

  // 1. Delete Expired Checks and their associated files via repository deleteExpired
  try {
    const expiredResult = deleteExpired(uploadDir, db);
    checksDeleted = expiredResult.deletedCount || 0;
    filesDeleted += (expiredResult.deletedFiles || []).length;
  } catch (err) {
    logger.error({ stage: "cleanup", step: "delete_expired", error: err.message });
    errors.push("DELETE_EXPIRED_FAILED");
  }

  // 2. Purge Expired Lookup Cache Entries
  try {
    cacheRowsPurged = purgeCache(db) || 0;
  } catch (err) {
    logger.error({ stage: "cleanup", step: "purge_cache", error: err.message });
    errors.push("PURGE_CACHE_FAILED");
  }

  // 3. Scan Uploads Directory for Orphan Files and Old Files
  try {
    if (fs.existsSync(resolvedUploadDir)) {
      const nowMs = nowFn();

      // Retrieve all active file_path rows from check_inputs
      const activeInputRows = db
        .prepare(`SELECT id, file_path, created_at FROM check_inputs WHERE file_path IS NOT NULL`)
        .all();

      const activePathsMap = new Map();
      for (const row of activeInputRows) {
        if (row.file_path) {
          const resolved = path.resolve(row.file_path);
          activePathsMap.set(resolved, row);
        }
      }

      const filesInDir = listFilesFn(resolvedUploadDir);

      for (const fileName of filesInDir) {
        // Disallow path navigation in entry name
        const filePath = path.resolve(resolvedUploadDir, fileName);

        // Security check: path traversal or escape guard
        if (
          !filePath.startsWith(resolvedUploadDir + path.sep) &&
          filePath !== resolvedUploadDir
        ) {
          logger.warn({ stage: "cleanup", code: "PATH_TRAVERSAL_REFUSED" });
          errors.push("PATH_TRAVERSAL_REFUSED");
          continue;
        }

        // Verify if symlink escapes
        try {
          if (fs.existsSync(filePath)) {
            const realPath = fs.realpathSync(filePath);
            if (
              !realPath.startsWith(resolvedUploadDir + path.sep) &&
              realPath !== resolvedUploadDir
            ) {
              logger.warn({ stage: "cleanup", code: "SYMLINK_ESCAPE_REFUSED" });
              errors.push("SYMLINK_ESCAPE_REFUSED");
              continue;
            }
          }
        } catch {
          // If realpath fails, skip deletion
          continue;
        }

        let shouldDelete = false;
        let isOldReferenced = false;
        const matchingInput = activePathsMap.get(filePath);

        if (!matchingInput) {
          // Orphan file: not referenced in check_inputs
          shouldDelete = true;
        } else {
          // Referenced file: check if age exceeds maxImageAgeMs
          const fileCreatedAt = matchingInput.created_at
            ? new Date(matchingInput.created_at).getTime()
            : 0;
          if (nowMs - fileCreatedAt >= maxImageAgeMs) {
            shouldDelete = true;
            isOldReferenced = true;
          }
        }

        if (shouldDelete) {
          try {
            unlinkFn(filePath);
            filesDeleted++;

            if (isOldReferenced && matchingInput) {
              // Clear file_path in DB so future references do not attempt reading deleted file
              clearInputFile(matchingInput.id, db);
            }
          } catch (unlinkErr) {
            logger.warn({
              stage: "cleanup",
              code: "UNLINK_FAILED",
              error: unlinkErr.message,
            });
            errors.push("UNLINK_FAILED");
          }
        }
      }
    }
  } catch (err) {
    logger.error({ stage: "cleanup", step: "orphan_scan", error: err.message });
    errors.push("ORPHAN_SCAN_FAILED");
  }

  // 4. Stale-Check Sweep: checks stuck in investigating or scoring longer than 10 minutes move to failed with coordinator_pipeline_error and emit check_event
  try {
    const nowMs = nowFn();
    const staleRows = listStaleChecks(
      ["investigating", "scoring"],
      staleInvestigationAgeMs,
      nowMs,
      db
    );
    for (const row of staleRows) {
      try {
        markCheckFailed(row.id, "coordinator_pipeline_error", {
          summary: "Investigation timed out or stalled (exceeded 10 minutes)",
          db,
        });
        staleChecksRecovered++;
        logger.warn({ checkId: row.id, previousStatus: row.status }, "Stale check moved to failed by cleanup sweep");
      } catch (err) {
        logger.error({ checkId: row.id, err: err?.message }, "Failed to fail stale check in cleanup sweep");
      }
    }
  } catch (err) {
    logger.error({ stage: "cleanup", step: "stale_check_sweep", error: err.message });
    errors.push("STALE_CHECK_SWEEP_FAILED");
  }

  // 5. Stale Crawl Sweep: crawl rows stuck in running for more than 5 minutes become failed with error code server_restart
  let staleCrawlsRecovered = 0;
  try {
    staleCrawlsRecovered = markStaleCrawlsFailed(300, db) || 0;
    if (staleCrawlsRecovered > 0) {
      logger.warn({ count: staleCrawlsRecovered }, "Stale crawls moved to failed by cleanup sweep");
    }
  } catch (err) {
    logger.error({ stage: "cleanup", step: "stale_crawl_sweep", error: err.message });
    errors.push("STALE_CRAWL_SWEEP_FAILED");
  }

  return {
    checksDeleted,
    cacheRowsPurged,
    filesDeleted,
    staleChecksRecovered,
    staleCrawlsRecovered,
    errors,
  };
}

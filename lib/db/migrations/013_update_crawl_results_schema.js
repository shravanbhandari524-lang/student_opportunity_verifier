/**
 * Migration 013: Update crawl_results schema
 *
 * Adds started_at, finished_at, error_code, enforces status in ('running', 'done', 'failed'),
 * allows nullable result_json during running state, and enforces UNIQUE(check_id, entity_id).
 */

export const name = "013_update_crawl_results_schema";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_results_new (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
      result_json TEXT,
      error_code TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(check_id, entity_id)
    );

    INSERT OR IGNORE INTO crawl_results_new (id, check_id, entity_id, status, result_json, error_code, started_at, finished_at, created_at, updated_at)
    SELECT
      id,
      check_id,
      entity_id,
      CASE
        WHEN status IN ('running', 'done', 'failed') THEN status
        WHEN status = 'completed' THEN 'done'
        ELSE 'failed'
      END AS status,
      result_json,
      NULL AS error_code,
      created_at AS started_at,
      updated_at AS finished_at,
      created_at,
      updated_at
    FROM crawl_results;

    DROP TABLE crawl_results;
    ALTER TABLE crawl_results_new RENAME TO crawl_results;

    CREATE INDEX IF NOT EXISTS idx_crawl_results_check_id ON crawl_results(check_id);
    CREATE INDEX IF NOT EXISTS idx_crawl_results_entity_id ON crawl_results(entity_id);
  `);
}

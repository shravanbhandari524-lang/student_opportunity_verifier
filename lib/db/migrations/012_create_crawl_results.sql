-- Migration 012: Create crawl_results table
CREATE TABLE IF NOT EXISTS crawl_results (
  id TEXT PRIMARY KEY,
  check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crawl_results_check_id ON crawl_results(check_id);
CREATE INDEX IF NOT EXISTS idx_crawl_results_entity_id ON crawl_results(entity_id);

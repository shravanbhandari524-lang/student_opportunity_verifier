/**
 * Migration 015: Create run_records table
 *
 * Persists full verification runs with per-agent logs, incremental writes,
 * final summary, and score tracking.
 */

export const name = "015_create_run_records";

export function up(db) {
  db.pragma("foreign_keys = OFF");

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS run_records (
        run_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        input_json TEXT NOT NULL,
        final_score INTEGER,
        score_unavailable_reason TEXT,
        verdict TEXT,
        final_summary TEXT,
        agents_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_records_created_at ON run_records(created_at DESC);
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

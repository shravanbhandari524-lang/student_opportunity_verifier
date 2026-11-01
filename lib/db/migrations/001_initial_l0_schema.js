/**
 * Migration 1: L0 Schema (initial foundation)
 * Forward-only transaction.
 */

export const name = "001_initial_l0_schema";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS checks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      risk_level TEXT,
      score REAL,
      confidence TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS check_inputs (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT,
      file_path TEXT,
      FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_results (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL,
      flags_json TEXT NOT NULL DEFAULT '[]',
      verified_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      duration_ms INTEGER,
      FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      check_id TEXT PRIMARY KEY,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      report_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(kind, value)
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      node_a TEXT NOT NULL,
      node_b TEXT NOT NULL,
      check_ref TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (node_a) REFERENCES graph_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (node_b) REFERENCES graph_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lookup_cache (
      key TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      ttl_seconds INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checks_expires_at ON checks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_check_inputs_check_id ON check_inputs(check_id);
    CREATE INDEX IF NOT EXISTS idx_entities_check_id ON entities(check_id);
    CREATE INDEX IF NOT EXISTS idx_agent_results_check_id ON agent_results(check_id);
  `);
}

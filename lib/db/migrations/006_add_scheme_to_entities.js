/**
 * Migration 006: Add scheme to entities kind CHECK constraint
 *
 * Implements scheme entity kind support specified in ARCHITECTURE.md:
 * - Recreates entities table with 'scheme' included in the kind CHECK constraint.
 * - Recreates graph_nodes table with 'scheme' included in the kind CHECK constraint.
 */

export const name = "006_add_scheme_to_entities";

export function up(db) {
  db.pragma("foreign_keys = OFF");

  try {
    const entitiesTableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='entities'`)
      .get();

    if (entitiesTableExists) {
      db.exec(`
        CREATE TABLE entities_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          check_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('domain', 'url', 'upi', 'email', 'phone', 'company', 'handle', 'amount', 'youtube_url', 'scheme')),
          value TEXT NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('extracted', 'user', 'discovered')),
          discovered_by TEXT CHECK (discovered_by IS NULL OR discovered_by IN ('message_analyst', 'website_forensics', 'official_verifier', 'reputation_osint', 'payment_entity', 'classifier_client')),
          round INTEGER NOT NULL DEFAULT 0 CHECK (round >= 0 AND round <= 2),
          confirmed INTEGER NOT NULL DEFAULT 1 CHECK (confirmed IN (0, 1)),
          evidence_json TEXT,
          platform TEXT,
          FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE,
          UNIQUE (check_id, kind, value)
        );

        INSERT INTO entities_new (id, check_id, kind, value, source, discovered_by, round, confirmed, evidence_json, platform)
        SELECT id, check_id, kind, value, source, discovered_by, round, confirmed, evidence_json, platform
        FROM entities;

        DROP TABLE entities;
        ALTER TABLE entities_new RENAME TO entities;
        CREATE INDEX IF NOT EXISTS idx_entities_check_id ON entities(check_id);
      `);
    }

    const graphNodesTableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='graph_nodes'`)
      .get();

    if (graphNodesTableExists) {
      db.exec(`
        CREATE TABLE graph_nodes_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK (kind IN ('domain', 'url', 'upi', 'email', 'phone', 'company', 'handle', 'amount', 'youtube_url', 'scheme')),
          value TEXT NOT NULL,
          first_seen TEXT NOT NULL,
          last_seen TEXT NOT NULL,
          report_count INTEGER NOT NULL DEFAULT 1 CHECK (report_count >= 0),
          UNIQUE(kind, value)
        );

        INSERT INTO graph_nodes_new (id, kind, value, first_seen, last_seen, report_count)
        SELECT id, kind, value, first_seen, last_seen, report_count
        FROM graph_nodes;

        CREATE TABLE graph_edges_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          node_a INTEGER NOT NULL,
          node_b INTEGER NOT NULL,
          check_ref TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (node_a) REFERENCES graph_nodes_new(id) ON DELETE CASCADE,
          FOREIGN KEY (node_b) REFERENCES graph_nodes_new(id) ON DELETE CASCADE,
          CHECK (node_a < node_b)
        );

        INSERT INTO graph_edges_new (id, node_a, node_b, check_ref, created_at)
        SELECT id, node_a, node_b, check_ref, created_at
        FROM graph_edges;

        DROP TABLE graph_edges;
        DROP TABLE graph_nodes;

        ALTER TABLE graph_nodes_new RENAME TO graph_nodes;
        ALTER TABLE graph_edges_new RENAME TO graph_edges;

        CREATE INDEX IF NOT EXISTS idx_graph_nodes_kind_value ON graph_nodes(kind, value);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_pair_ref ON graph_edges(node_a, node_b, check_ref);
        CREATE INDEX IF NOT EXISTS idx_graph_edges_node_b ON graph_edges(node_b);
      `);
    }

    const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
    if (fkCheck.length > 0) {
      throw new Error(`Foreign key check failed after migration 006: ${JSON.stringify(fkCheck)}`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

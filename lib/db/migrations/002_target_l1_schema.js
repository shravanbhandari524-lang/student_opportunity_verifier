/**
 * Migration 2: Target Schema Rebuild (L1 Target Schema)
 * Implements the table-rebuild pattern from ARCHITECTURE.md and docs/contracts.md section 6:
 * - PRAGMA foreign_keys = OFF
 * - Create _new tables with INTEGER AUTOINCREMENT primary keys, CHECK constraints, and exact types
 * - Copy existing data across
 * - Drop old tables and rename _new tables
 * - Create new tables (check_events) and indexes
 * - PRAGMA foreign_key_check
 * - PRAGMA foreign_keys = ON
 */

export const name = "002_target_l1_schema";

export function up(db) {
  // SQLite table rebuild pattern:
  // Must disable foreign keys before dropping/rebuilding referenced tables
  db.pragma("foreign_keys = OFF");

  try {
    // 0. Clean up legacy checks with non-UUID ids at the start of migration 002.
    // Decision: All check IDs in the L1 contract must be strict UUIDs (crypto.randomUUID).
    // Any legacy check with a non-UUID ID and all of its child rows (via cascade delete in check_inputs,
    // entities, agent_results, reports) are purged.
    // Note: feedback referencing deleted non-UUID checks keeps its row with check_id set to NULL;
    // graph nodes and graph edges are preserved and untouched.
    const hasChecks = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='checks'`).get();
    if (hasChecks) {
      // Temporarily enable foreign keys for cascading deletion across L0 check-owned tables
      db.pragma("foreign_keys = ON");
      db.exec(`
        DELETE FROM checks
        WHERE id NOT GLOB '[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]';
      `);
      db.pragma("foreign_keys = OFF");
    }

    // 1. checks_new
    db.exec(`
      CREATE TABLE checks_new (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('created', 'extracting', 'awaiting_confirmation', 'investigating', 'scoring', 'report_ready', 'failed')),
        current_round INTEGER NOT NULL DEFAULT 0 CHECK (current_round >= 0 AND current_round <= 2),
        language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
        risk_level TEXT CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'cannot_verify')),
        score INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
        confidence TEXT CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),
        failure_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);

    // Copy from checks to checks_new if checks table exists
    if (hasChecks) {
      db.exec(`
        INSERT INTO checks_new (id, status, current_round, language, risk_level, score, confidence, failure_reason, created_at, updated_at, expires_at)
        SELECT
          id,
          status,
          0 AS current_round,
          language,
          risk_level,
          CAST(ROUND(score) AS INTEGER) AS score,
          confidence,
          NULL AS failure_reason,
          created_at,
          created_at AS updated_at,
          expires_at
        FROM checks;
        DROP TABLE checks;
      `);
    }
    db.exec(`ALTER TABLE checks_new RENAME TO checks;`);

    // 2. check_inputs_new (INTEGER PRIMARY KEY AUTOINCREMENT)
    db.exec(`
      CREATE TABLE check_inputs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('text', 'image', 'url', 'upi', 'company', 'handle', 'phone', 'youtube_url')),
        value TEXT,
        file_path TEXT,
        mime_type TEXT,
        size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes > 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
      );
    `);

    const hasInputs = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='check_inputs'`).get();
    if (hasInputs) {
      db.exec(`
        INSERT INTO check_inputs_new (check_id, type, value, file_path, mime_type, size_bytes, created_at)
        SELECT
          check_id,
          type,
          value,
          file_path,
          NULL AS mime_type,
          NULL AS size_bytes,
          datetime('now') AS created_at
        FROM check_inputs;
        DROP TABLE check_inputs;
      `);
    }
    db.exec(`ALTER TABLE check_inputs_new RENAME TO check_inputs;`);

    // 3. entities_new (INTEGER PRIMARY KEY AUTOINCREMENT)
    db.exec(`
      CREATE TABLE entities_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('domain', 'url', 'upi', 'email', 'phone', 'company', 'handle', 'amount', 'youtube_url')),
        value TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('extracted', 'user', 'discovered')),
        discovered_by TEXT CHECK (discovered_by IS NULL OR discovered_by IN ('message_analyst', 'website_forensics', 'official_verifier', 'reputation_osint', 'payment_entity', 'classifier_client')),
        round INTEGER NOT NULL DEFAULT 0 CHECK (round >= 0 AND round <= 2),
        confirmed INTEGER NOT NULL DEFAULT 1 CHECK (confirmed IN (0, 1)),
        evidence_json TEXT,
        FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE,
        UNIQUE (check_id, kind, value)
      );
    `);

    const hasEntities = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='entities'`).get();
    if (hasEntities) {
      db.exec(`
        INSERT OR IGNORE INTO entities_new (check_id, kind, value, source, discovered_by, round, confirmed, evidence_json)
        SELECT
          check_id,
          kind,
          value,
          source,
          NULL AS discovered_by,
          0 AS round,
          confirmed,
          NULL AS evidence_json
        FROM entities;
        DROP TABLE entities;
      `);
    }
    db.exec(`ALTER TABLE entities_new RENAME TO entities;`);

    // 4. agent_results_new (INTEGER PRIMARY KEY AUTOINCREMENT)
    db.exec(`
      CREATE TABLE agent_results_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id TEXT NOT NULL,
        agent TEXT NOT NULL CHECK (agent IN ('message_analyst', 'website_forensics', 'official_verifier', 'reputation_osint', 'payment_entity', 'classifier_client')),
        round INTEGER NOT NULL CHECK (round IN (1, 2)),
        kind TEXT NOT NULL CHECK (kind IN ('check', 'llm_call', 'agent')),
        status TEXT NOT NULL CHECK (status IN ('ok', 'skipped', 'could_not_check')),
        reason TEXT,
        flags_json TEXT NOT NULL DEFAULT '[]',
        verified_json TEXT NOT NULL DEFAULT '[]',
        new_entities_json TEXT NOT NULL DEFAULT '[]',
        processed_json TEXT NOT NULL DEFAULT '[]',
        unchecked_json TEXT NOT NULL DEFAULT '[]',
        manual_checks_json TEXT NOT NULL DEFAULT '[]',
        trace_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
        FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE,
        UNIQUE (check_id, agent, round)
      );
    `);

    const hasAgentResults = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_results'`).get();
    if (hasAgentResults) {
      db.exec(`
        INSERT OR IGNORE INTO agent_results_new (check_id, agent, round, kind, status, reason, flags_json, verified_json, new_entities_json, processed_json, unchecked_json, manual_checks_json, trace_json, notes, duration_ms)
        SELECT
          check_id,
          agent,
          1 AS round,
          'check' AS kind,
          status,
          NULL AS reason,
          flags_json,
          verified_json,
          '[]' AS new_entities_json,
          '[]' AS processed_json,
          '[]' AS unchecked_json,
          '[]' AS manual_checks_json,
          '[]' AS trace_json,
          notes,
          COALESCE(duration_ms, 0) AS duration_ms
        FROM agent_results;
        DROP TABLE agent_results;
      `);
    }
    db.exec(`ALTER TABLE agent_results_new RENAME TO agent_results;`);

    // 5. check_events (NEW TABLE)
    db.exec(`
      CREATE TABLE IF NOT EXISTS check_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id TEXT NOT NULL,
        round INTEGER CHECK (round IS NULL OR (round >= 0 AND round <= 2)),
        type TEXT NOT NULL CHECK (type IN ('stage', 'round', 'agent', 'complete', 'error')),
        agent TEXT CHECK (agent IS NULL OR agent IN ('message_analyst', 'website_forensics', 'official_verifier', 'reputation_osint', 'payment_entity', 'classifier_client')),
        status TEXT,
        summary TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
      );
    `);

    // 6. reports_new
    db.exec(`
      CREATE TABLE reports_new (
        check_id TEXT PRIMARY KEY,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
      );
    `);

    const hasReports = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='reports'`).get();
    if (hasReports) {
      db.exec(`
        INSERT INTO reports_new (check_id, report_json, created_at)
        SELECT check_id, report_json, created_at FROM reports;
        DROP TABLE reports;
      `);
    }
    db.exec(`ALTER TABLE reports_new RENAME TO reports;`);

    // 7. graph_nodes_new (INTEGER PRIMARY KEY AUTOINCREMENT, last_seen)
    db.exec(`
      CREATE TABLE graph_nodes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('domain', 'url', 'upi', 'email', 'phone', 'company', 'handle', 'amount', 'youtube_url')),
        value TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        report_count INTEGER NOT NULL DEFAULT 1 CHECK (report_count >= 0),
        UNIQUE(kind, value)
      );

      CREATE TABLE graph_edges_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_a INTEGER NOT NULL,
        node_b INTEGER NOT NULL,
        check_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (node_a) REFERENCES graph_nodes_new(id) ON DELETE CASCADE,
        FOREIGN KEY (node_b) REFERENCES graph_nodes_new(id) ON DELETE CASCADE
      );
    `);

    const hasGraphNodes = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='graph_nodes'`).get();
    const hasGraphEdges = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='graph_edges'`).get();

    if (hasGraphNodes) {
      // Create a temporary mapping table old_id -> new_id
      db.exec(`
        CREATE TABLE _graph_node_map (
          old_id TEXT PRIMARY KEY,
          new_id INTEGER
        );
      `);

      const oldNodes = db.prepare(`SELECT id, kind, value, first_seen, report_count FROM graph_nodes`).all();
      const insertNewNode = db.prepare(`
        INSERT INTO graph_nodes_new (kind, value, first_seen, last_seen, report_count)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertMap = db.prepare(`INSERT INTO _graph_node_map (old_id, new_id) VALUES (?, ?)`);

      for (const on of oldNodes) {
        const info = insertNewNode.run(on.kind, on.value, on.first_seen, on.first_seen, on.report_count);
        insertMap.run(on.id, info.lastInsertRowid);
      }

      if (hasGraphEdges) {
        db.exec(`
          INSERT INTO graph_edges_new (node_a, node_b, check_ref, created_at)
          SELECT
            MIN(ma.new_id, mb.new_id) AS node_a,
            MAX(ma.new_id, mb.new_id) AS node_b,
            COALESCE(ge.check_ref, 'legacy') AS check_ref,
            MIN(ge.created_at) AS created_at
          FROM graph_edges ge
          JOIN _graph_node_map ma ON ma.old_id = ge.node_a
          JOIN _graph_node_map mb ON mb.old_id = ge.node_b
          WHERE ma.new_id != mb.new_id
          GROUP BY MIN(ma.new_id, mb.new_id), MAX(ma.new_id, mb.new_id), COALESCE(ge.check_ref, 'legacy');
          DROP TABLE graph_edges;
        `);
      }
      db.exec(`
        DROP TABLE _graph_node_map;
        DROP TABLE graph_nodes;
      `);
    } else if (hasGraphEdges) {
      db.exec(`DROP TABLE graph_edges;`);
    }

    db.exec(`
      ALTER TABLE graph_nodes_new RENAME TO graph_nodes;
      ALTER TABLE graph_edges_new RENAME TO graph_edges;
    `);

    // 9. feedback_new (INTEGER PRIMARY KEY AUTOINCREMENT, check_id nullable with ON DELETE SET NULL, verdict in ('right', 'wrong'), comment max 500)
    db.exec(`
      CREATE TABLE feedback_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id TEXT,
        verdict TEXT NOT NULL CHECK (verdict IN ('right', 'wrong')),
        risk_level_shown TEXT CHECK (risk_level_shown IS NULL OR risk_level_shown IN ('low', 'medium', 'high', 'cannot_verify')),
        comment TEXT CHECK (comment IS NULL OR length(comment) <= 500),
        created_at TEXT NOT NULL,
        FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE SET NULL
      );
    `);

    const hasFeedback = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'`).get();
    if (hasFeedback) {
      // Map verdict explicitly:
      // 'wrong', 'unhelpful', 'inaccurate' become 'wrong'
      // 'right', 'helpful', 'accurate' become 'right'
      // Any other value is excluded/not copied.
      db.exec(`
        INSERT INTO feedback_new (check_id, verdict, risk_level_shown, comment, created_at)
        SELECT
          c.id AS check_id,
          CASE
            WHEN fb.verdict IN ('wrong', 'unhelpful', 'inaccurate') THEN 'wrong'
            WHEN fb.verdict IN ('right', 'helpful', 'accurate') THEN 'right'
          END AS verdict,
          NULL AS risk_level_shown,
          CASE WHEN length(fb.comment) > 500 THEN substr(fb.comment, 1, 500) ELSE fb.comment END AS comment,
          fb.created_at
        FROM feedback fb
        LEFT JOIN checks c ON c.id = fb.check_id
        WHERE fb.verdict IN ('wrong', 'unhelpful', 'inaccurate', 'right', 'helpful', 'accurate');
        DROP TABLE feedback;
      `);
    }
    db.exec(`ALTER TABLE feedback_new RENAME TO feedback;`);

    // 10. lookup_cache_new (fetched_at INTEGER epoch seconds)
    db.exec(`
      CREATE TABLE lookup_cache_new (
        key TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        ttl_seconds INTEGER NOT NULL CHECK (ttl_seconds >= 0)
      );
    `);

    const hasCache = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='lookup_cache'`).get();
    if (hasCache) {
      db.exec(`
        INSERT INTO lookup_cache_new (key, result_json, fetched_at, ttl_seconds)
        SELECT
          key,
          result_json,
          strftime('%s', fetched_at) AS fetched_at,
          ttl_seconds
        FROM lookup_cache;
        DROP TABLE lookup_cache;
      `);
    }
    db.exec(`ALTER TABLE lookup_cache_new RENAME TO lookup_cache;`);

    // 11. Create Indexes
    db.exec(`
      CREATE INDEX idx_checks_expires_at ON checks(expires_at);
      CREATE INDEX idx_check_inputs_check_id ON check_inputs(check_id);
      CREATE INDEX idx_entities_check_id ON entities(check_id);
      CREATE INDEX idx_agent_results_check_id ON agent_results(check_id);
      CREATE INDEX idx_check_events_check_id ON check_events(check_id);
      CREATE INDEX idx_feedback_check_id ON feedback(check_id);
      CREATE INDEX idx_lookup_cache_fetched_at ON lookup_cache(fetched_at);
    `);

    // 12. Run foreign_key_check
    const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
    if (fkCheck.length > 0) {
      throw new Error(`Foreign key check failed after migration: ${JSON.stringify(fkCheck)}`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

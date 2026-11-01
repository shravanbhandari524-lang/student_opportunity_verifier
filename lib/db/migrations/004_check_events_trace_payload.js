/**
 * Migration 004: Add seq and payload_json to check_events
 *
 * Implements the schema update specified in ARCHITECTURE.md sections 9 and 9.2:
 * - PRAGMA foreign_keys = OFF
 * - Create check_events_new with:
 *     id INTEGER PRIMARY KEY AUTOINCREMENT,
 *     check_id TEXT NOT NULL,
 *     seq INTEGER NOT NULL,
 *     round INTEGER CHECK (round IS NULL OR (round >= 0 AND round <= 2)),
 *     type TEXT NOT NULL,
 *     agent TEXT,
 *     status TEXT,
 *     summary TEXT,
 *     payload_json TEXT NOT NULL,
 *     created_at TEXT NOT NULL,
 *     FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE,
 *     UNIQUE(check_id, seq)
 * - Backfill seq (partitioned by check_id, ordered by created_at, id) and minimal payload_json
 * - Drop old table and rename check_events_new to check_events
 * - Recreate indexes: idx_check_events_check_id and idx_check_events_check_seq
 * - PRAGMA foreign_key_check
 * - PRAGMA foreign_keys = ON
 */

export const name = "004_check_events_trace_payload";

export function up(db) {
  db.pragma("foreign_keys = OFF");

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS check_events_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        round INTEGER CHECK (round IS NULL OR (round >= 0 AND round <= 2)),
        type TEXT NOT NULL,
        agent TEXT,
        status TEXT,
        summary TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE,
        UNIQUE(check_id, seq)
      );
    `);

    // Check if old check_events table exists
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='check_events'`)
      .get();

    if (tableExists) {
      db.exec(`
        INSERT INTO check_events_new (id, check_id, seq, round, type, agent, status, summary, payload_json, created_at)
        SELECT
          id,
          check_id,
          ROW_NUMBER() OVER (PARTITION BY check_id ORDER BY created_at ASC, id ASC) AS seq,
          round,
          type,
          agent,
          status,
          summary,
          json_object(
            'seq', ROW_NUMBER() OVER (PARTITION BY check_id ORDER BY created_at ASC, id ASC),
            'checkId', check_id,
            'ts', created_at,
            'round', COALESCE(round, 0),
            'agent', agent,
            'type', type,
            'status', status,
            'summary', summary
          ) AS payload_json,
          created_at
        FROM check_events;

        DROP TABLE check_events;
      `);
    }

    db.exec(`ALTER TABLE check_events_new RENAME TO check_events;`);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_check_events_check_id ON check_events(check_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_check_events_check_seq ON check_events(check_id, seq);
    `);

    const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
    if (fkCheck.length > 0) {
      throw new Error(`Foreign key check failed after migration 004: ${JSON.stringify(fkCheck)}`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

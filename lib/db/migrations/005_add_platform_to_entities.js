/**
 * Migration 005: Add platform to entities and user_notes to check_inputs
 *
 * Implements schema updates specified in ARCHITECTURE.md sections 3.2 and 9:
 * - Adds platform TEXT to entities table if not present.
 * - Recreates check_inputs table to permit 'user_notes' in type CHECK constraint.
 */

export const name = "005_add_platform_to_entities";

export function up(db) {
  db.pragma("foreign_keys = OFF");

  try {
    // 1. Add platform column to entities if not present
    const entityCols = db.pragma("table_info(entities)");
    const hasPlatform = entityCols.some((c) => c.name === "platform");
    if (!hasPlatform) {
      db.exec(`ALTER TABLE entities ADD COLUMN platform TEXT;`);
    }

    // 2. Recreate check_inputs table to support 'user_notes' in type check constraint
    const inputsTableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='check_inputs'`)
      .get();

    if (inputsTableExists) {
      db.exec(`
        CREATE TABLE check_inputs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          check_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('text', 'image', 'url', 'upi', 'company', 'handle', 'phone', 'youtube_url', 'user_notes')),
          value TEXT,
          file_path TEXT,
          mime_type TEXT,
          size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes > 0),
          created_at TEXT NOT NULL,
          FOREIGN KEY (check_id) REFERENCES checks(id) ON DELETE CASCADE
        );

        INSERT INTO check_inputs_new (id, check_id, type, value, file_path, mime_type, size_bytes, created_at)
        SELECT id, check_id, type, value, file_path, mime_type, size_bytes, created_at
        FROM check_inputs;

        DROP TABLE check_inputs;
        ALTER TABLE check_inputs_new RENAME TO check_inputs;
        CREATE INDEX IF NOT EXISTS idx_check_inputs_check_id ON check_inputs(check_id);
      `);
    }

    const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
    if (fkCheck.length > 0) {
      throw new Error(`Foreign key check failed after migration 005: ${JSON.stringify(fkCheck)}`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

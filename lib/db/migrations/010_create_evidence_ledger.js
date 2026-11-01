/**
 * Migration 010: Create evidence_ledger table
 *
 * Persists normalized evidence ledger entries for each check:
 * - id TEXT PRIMARY KEY
 * - check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE
 * - agent TEXT NOT NULL
 * - round INTEGER NOT NULL
 * - kind TEXT NOT NULL
 * - flag_id TEXT
 * - claim_key TEXT NOT NULL
 * - quote_or_url TEXT
 * - evidence_type TEXT NOT NULL
 * - verification_status TEXT NOT NULL
 * - confidence TEXT NOT NULL
 * - supporting_source TEXT
 * - timestamp TEXT NOT NULL
 */

export const name = "010_create_evidence_ledger";

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_ledger (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      round INTEGER NOT NULL,
      kind TEXT NOT NULL,
      flag_id TEXT,
      claim_key TEXT NOT NULL,
      quote_or_url TEXT,
      evidence_type TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      confidence TEXT NOT NULL,
      supporting_source TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_ledger_check_id ON evidence_ledger(check_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_ledger_claim_key ON evidence_ledger(claim_key);
  `);
}

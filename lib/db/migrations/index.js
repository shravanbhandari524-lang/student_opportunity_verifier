import * as m001 from "./001_initial_l0_schema.js";
import * as m002 from "./002_target_l1_schema.js";
import * as m003 from "./003_add_classifier_result_to_agent_results.js";
import * as m004 from "./004_check_events_trace_payload.js";
import * as m005 from "./005_add_platform_to_entities.js";
import * as m006 from "./006_add_scheme_to_entities.js";
import * as m007 from "./007_add_activity_and_summary_to_agent_results.js";
import * as m008 from "./008_add_org_type_to_entities.js";
import * as m009 from "./009_add_entity_status_and_purpose.js";
import * as m010 from "./010_create_evidence_ledger.js";
import * as m011 from "./011_add_direction_to_entities.js";
import * as m012 from "./012_create_crawl_results.js";
import * as m013 from "./013_update_crawl_results_schema.js";

export const MIGRATIONS = [
  { version: 1, name: m001.name, up: m001.up },
  { version: 2, name: m002.name, up: m002.up },
  { version: 3, name: m003.name, up: m003.up },
  { version: 4, name: m004.name, up: m004.up },
  { version: 5, name: m005.name, up: m005.up },
  { version: 6, name: m006.name, up: m006.up },
  { version: 7, name: m007.name, up: m007.up },
  { version: 8, name: m008.name, up: m008.up },
  { version: 9, name: m009.name, up: m009.up },
  { version: 10, name: m010.name, up: m010.up },
  { version: 11, name: m011.name, up: m011.up },
  { version: 12, name: m012.name, up: m012.up },
  { version: 13, name: m013.name, up: m013.up },
];

/**
 * Runs all pending migrations forward in sequence.
 * Tracks applied migrations in `schema_migrations`.
 * Safe to run multiple times (idempotent).
 * @param {import("better-sqlite3").Database} db
 */
export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare(`SELECT version FROM schema_migrations`).all();
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      // Run each migration inside an explicit transaction
      const runTx = db.transaction(() => {
        migration.up(db);
        db.prepare(
          `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime('now'))`
        ).run(migration.version, migration.name);
      });
      runTx();
    }
  }
}

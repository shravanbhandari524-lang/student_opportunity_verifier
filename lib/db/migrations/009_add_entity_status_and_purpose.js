/**
 * Migration 009: Add entity_status_json to agent_results and purpose to entities table
 *
 * Implements:
 * 1. entity_status_json TEXT column on agent_results for entity verification statuses.
 * 2. purpose TEXT column on entities for amount purposes.
 */

export const name = "009_add_entity_status_and_purpose";

export function up(db) {
  const resultCols = db.pragma("table_info(agent_results)");
  const hasEntityStatus = resultCols.some((c) => c.name === "entity_status_json");
  if (!hasEntityStatus) {
    db.exec(`ALTER TABLE agent_results ADD COLUMN entity_status_json TEXT NOT NULL DEFAULT '[]';`);
  }

  const entityCols = db.pragma("table_info(entities)");
  const hasPurpose = entityCols.some((c) => c.name === "purpose");
  if (!hasPurpose) {
    db.exec(`ALTER TABLE entities ADD COLUMN purpose TEXT;`);
  }
}

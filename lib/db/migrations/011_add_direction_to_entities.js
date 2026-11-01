/**
 * Migration 011: Add direction to entities table
 *
 * Implements direction TEXT column on entities for amount directions (to_candidate, from_candidate, unclear).
 */

export const name = "011_add_direction_to_entities";

export function up(db) {
  const entityCols = db.pragma("table_info(entities)");
  const hasDirection = entityCols.some((c) => c.name === "direction");
  if (!hasDirection) {
    db.exec(`ALTER TABLE entities ADD COLUMN direction TEXT;`);
  }
}

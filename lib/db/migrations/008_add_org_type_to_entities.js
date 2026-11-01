/**
 * Migration 008: Add org_type to entities table
 *
 * Implements entity typing for company entities:
 * - Adds org_type TEXT column to entities table.
 */

export const name = "008_add_org_type_to_entities";

export function up(db) {
  const entityCols = db.pragma("table_info(entities)");
  const hasOrgType = entityCols.some((c) => c.name === "org_type");
  if (!hasOrgType) {
    db.exec(`ALTER TABLE entities ADD COLUMN org_type TEXT;`);
  }
}

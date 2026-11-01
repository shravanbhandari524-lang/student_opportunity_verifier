/**
 * Migration 3: Add classifier_result_json to agent_results table
 * Forward-only migration adding a nullable TEXT column for classifierResult.
 */

export const name = "003_add_classifier_result_to_agent_results";

export function up(db) {
  db.exec(`
    ALTER TABLE agent_results ADD COLUMN classifier_result_json TEXT;
  `);
}

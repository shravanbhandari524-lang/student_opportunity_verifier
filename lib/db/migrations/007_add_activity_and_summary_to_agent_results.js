/**
 * Migration 7: Add activity_json and summary to agent_results table
 * Forward-only migration adding activity log array and one-sentence summary.
 */

export const name = "007_add_activity_and_summary_to_agent_results";

export function up(db) {
  db.exec(`
    ALTER TABLE agent_results ADD COLUMN activity_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE agent_results ADD COLUMN summary TEXT NOT NULL DEFAULT '';
  `);
}

/**
 * scripts/seedGraph.js
 *
 * Seeds the scam graph from lib/data/seed-graph.json.
 *
 * Invariant: Idempotent. Checks whether checkRef already seeded its edges before inserting.
 * If already seeded, skips re-inserting to avoid double-incrementing report_count.
 */

import fs from "node:fs";
import { getDb } from "../lib/db/index.js";
import { recordReport, computeCheckRef } from "../lib/graph.js";

// Load .env.local if present
if (fs.existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore
  }
}

/**
 * Seeds the graph from seed-graph.json.
 *
 * @param {object} [db]
 * @returns {{ seededCount: number, skippedCount: number }}
 */
export function seedGraph(db = getDb()) {
  const raw = fs.readFileSync(new URL("../lib/data/seed-graph.json", import.meta.url), "utf-8");
  const reports = JSON.parse(raw);

  let seededCount = 0;
  let skippedCount = 0;

  const checkEdgeStmt = db.prepare(`SELECT 1 FROM graph_edges WHERE check_ref = ? LIMIT 1`);

  for (const rep of reports) {
    const checkRef = computeCheckRef(rep.checkId);
    const existing = checkEdgeStmt.get(checkRef);

    if (existing) {
      skippedCount++;
      continue;
    }

    const res = recordReport({
      identifiers: rep.identifiers,
      checkId: rep.checkId,
      riskLevel: rep.riskLevel,
      consent: rep.consent,
    }, { db });

    if (res.recorded) {
      seededCount++;
    } else {
      skippedCount++;
    }
  }

  return { seededCount, skippedCount };
}

// Runnable script entrypoint
if (process.argv[1] && process.argv[1].endsWith("seedGraph.js")) {
  const result = seedGraph();
  console.log(`Graph seeding complete: ${result.seededCount} reports seeded, ${result.skippedCount} skipped.`);
}

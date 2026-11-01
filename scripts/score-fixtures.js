import process from "node:process";
import { scoreCase } from "../lib/scoring/score.js";
import { defaultConfig } from "../lib/scoring/config.js";
import { ScoreResultSchema } from "../lib/contracts/index.js";
import {
  buildClearScamCaseFile,
  buildGenuineNoticeCaseFile,
  buildAmbiguousThinEvidenceCaseFile,
} from "../lib/contracts/fixtures/scenarios/index.js";

/**
 * Parses command line arguments for optional --expect overrides.
 * Format: --expect A=level,B=level,C=level or --expect=A=level,B=level,C=level
 *
 * @param {string[]} args
 * @returns {Record<string, string>}
 */
function parseExpectedLevels(args) {
  const expected = {
    A: "high",
    B: "low",
    C: "cannot_verify",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let value = null;
    if (arg.startsWith("--expect=")) {
      value = arg.slice("--expect=".length);
    } else if (arg === "--expect" && i + 1 < args.length) {
      value = args[++i];
    }
    if (value) {
      const parts = value.split(",");
      for (const part of parts) {
        const [k, v] = part.split("=");
        if (k && v) {
          expected[k.trim()] = v.trim();
        }
      }
    }
  }

  return expected;
}

function main() {
  const expectedLevels = parseExpectedLevels(process.argv.slice(2));

  const scenarios = [
    { key: "A", name: "Scenario A (Clear Scam)", caseFile: buildClearScamCaseFile() },
    { key: "B", name: "Scenario B (Genuine Notice)", caseFile: buildGenuineNoticeCaseFile() },
    { key: "C", name: "Scenario C (Ambiguous Thin Evidence)", caseFile: buildAmbiguousThinEvidenceCaseFile() },
  ];

  // Assert that each scenario snapshot has at least one agent result before scoring
  for (const sc of scenarios) {
    const findings = sc.caseFile?.findings;
    if (!Array.isArray(findings) || findings.length === 0) {
      console.error(`Error: Scenario ${sc.key} (${sc.name}) has empty findings. Expected at least 1 agent result.`);
      process.exit(1);
    }
  }

  const tableRows = [];
  let allMatched = true;

  for (const sc of scenarios) {
    const result = scoreCase(sc.caseFile, defaultConfig);

    // Validate with ScoreResultSchema
    ScoreResultSchema.parse(result);

    const countedFlags = result.flagPoints
      .filter((fp) => fp.status === "counted")
      .map((fp) => `${fp.id} (${fp.points})`)
      .join("; ");

    const expectedLevel = expectedLevels[sc.key];
    const match = result.level === expectedLevel;
    if (!match) {
      allMatched = false;
    }

    tableRows.push({
      scenario: sc.name,
      level: result.level,
      expected: expectedLevel,
      score: result.score,
      confidence: result.confidence,
      "completedCount/eligibleCount": `${result.completedCount}/${result.eligibleCount}`,
      rulesFired: result.rulesFired.join(", ") || "none",
      classifierPoints: result.classifierPoints,
      confidenceCapped: result.confidenceCapped,
      countedFlagsWithPoints: countedFlags || "none",
      match: match ? "PASS" : "FAIL",
    });
  }

  console.log("\nOpportunity Verification Fixtures Scoring Table:");
  console.table(tableRows);

  if (!allMatched) {
    console.error("\nScore mismatch detected against expectations!");
    for (const row of tableRows) {
      if (row.match === "FAIL") {
        console.error(`- ${row.scenario}: expected level "${row.expected}", got "${row.level}"`);
      }
    }
    process.exit(1);
  }

  console.log("\nAll scenario levels matched expectations successfully.");
  process.exit(0);
}

main();

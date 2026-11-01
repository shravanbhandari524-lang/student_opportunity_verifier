import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getDb } from "../lib/db/index.js";
import { getCaseFile, renderMarkdown } from "../lib/caseFile.js";
import {
  buildClearScamCaseFile,
  buildGenuineNoticeCaseFile,
  buildAmbiguousThinEvidenceCaseFile as buildAmbiguousCaseFile,
} from "../lib/contracts/fixtures/scenarios/index.js";
import {
  saveInputs,
  replaceEntities,
  saveAgentResult,
  appendEvent,
} from "../lib/db/index.js";

const TEST_DB = "./data/test_case_file.db";

function resetDb() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  return getDb(TEST_DB);
}

function persistCaseFile(scenarioCaseFile, db) {
  const check = scenarioCaseFile.check;

  // Insert check row directly
  const insertCheck = db.prepare(`
    INSERT INTO checks (id, status, current_round, language, risk_level, score, confidence, failure_reason, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertCheck.run(
    check.id,
    check.status,
    check.currentRound,
    check.language,
    check.riskLevel || null,
    check.score !== undefined ? check.score : null,
    check.confidence || null,
    check.failureReason || null,
    check.createdAt,
    check.updatedAt,
    check.expiresAt
  );

  saveInputs(check.id, scenarioCaseFile.inputs, db);
  replaceEntities(check.id, scenarioCaseFile.entities, db);

  for (const finding of scenarioCaseFile.findings) {
    saveAgentResult(check.id, finding, db);
  }

  for (const event of scenarioCaseFile.events) {
    appendEvent(check.id, event, db);
  }
}

test("CaseFile: Assemble Scenario A (Clear Scam) from database and render markdown", () => {
  const db = resetDb();
  const scenarioA = buildClearScamCaseFile();

  persistCaseFile(scenarioA, db);

  const assembled = getCaseFile(scenarioA.check.id, db);
  assert.equal(assembled.check.id, scenarioA.check.id);
  assert.equal(assembled.check.riskLevel, "high");
  assert.equal(assembled.inputs.length, scenarioA.inputs.length);
  assert.equal(assembled.entities.length, scenarioA.entities.length);
  assert.equal(assembled.findings.length, scenarioA.findings.length);
  assert.equal(assembled.events.length, scenarioA.events.length);
  assert.ok(assembled.control.processedEntitiesByAgent["message_analyst"]);

  // Render markdown with options
  const md = renderMarkdown(assembled, { includeEvents: true });
  assert.ok(md.includes(`# Case File: ${scenarioA.check.id}`));
  assert.ok(md.includes("- **Risk Level:** HIGH"));
  assert.ok(md.includes("## Specialist Findings"));
  assert.ok(md.includes("## Timeline Events"));
  assert.ok(md.includes("scholarship_fee_demand"));
});

test("CaseFile: Assemble Scenario B (Genuine Notice) from database and render markdown", () => {
  const db = resetDb();
  const scenarioB = buildGenuineNoticeCaseFile();

  persistCaseFile(scenarioB, db);

  const assembled = getCaseFile(scenarioB.check.id, db);
  assert.equal(assembled.check.id, scenarioB.check.id);
  assert.equal(assembled.check.riskLevel, "low");
  assert.equal(assembled.findings.length, scenarioB.findings.length);

  const md = renderMarkdown(assembled, { includeEvents: false });
  assert.ok(md.includes(`# Case File: ${scenarioB.check.id}`));
  assert.ok(md.includes("- **Risk Level:** LOW"));
  assert.ok(md.includes("## Specialist Findings"));
  assert.equal(md.includes("## Timeline Events"), false);
});

test("CaseFile: Assemble Scenario C (Ambiguous Thin Evidence) from database and render markdown", () => {
  const db = resetDb();
  const scenarioC = buildAmbiguousCaseFile();

  persistCaseFile(scenarioC, db);

  const assembled = getCaseFile(scenarioC.check.id, db);
  assert.equal(assembled.check.id, scenarioC.check.id);
  assert.equal(assembled.check.riskLevel, "cannot_verify");
  assert.equal(assembled.check.confidence, "low");

  const md = renderMarkdown(assembled);
  assert.ok(md.includes(`# Case File: ${scenarioC.check.id}`));
  assert.ok(md.includes("- **Risk Level:** CANNOT_VERIFY"));
  assert.ok(md.includes("- **Confidence:** low"));
  assert.ok(md.includes("off_platform_contact"));
});

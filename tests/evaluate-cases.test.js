import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Evaluation cases format and schema compliance", () => {
  const casesDir = path.resolve(process.cwd(), "tests/eval/cases");
  assert.ok(fs.existsSync(casesDir), "tests/eval/cases directory must exist");

  const files = fs.readdirSync(casesDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0, "At least one evaluation case must exist");

  for (const file of files) {
    const raw = fs.readFileSync(path.join(casesDir, file), "utf8");
    const parsed = JSON.parse(raw);

    assert.ok(typeof parsed.id === "string" && parsed.id.length > 0, "id is required");
    assert.ok(parsed.input && typeof parsed.input === "object", "input object is required");
    assert.ok(
      typeof parsed.input.text === "string" || typeof parsed.input.link === "string",
      "input text or link is required"
    );
    assert.ok(
      ["low", "medium", "high", "cannot_verify"].includes(parsed.expectedLevel),
      `Valid expectedLevel required, got ${parsed.expectedLevel}`
    );
    assert.ok(
      Array.isArray(parsed.expectedFlagsIncluded),
      "expectedFlagsIncluded must be an array"
    );
    assert.ok(typeof parsed.notes === "string", "notes string is required");
  }

  // Specifically check gov-scholarship-case.json
  const govCaseRaw = fs.readFileSync(path.join(casesDir, "gov-scholarship-case.json"), "utf8");
  const govCase = JSON.parse(govCaseRaw);
  assert.equal(govCase.id, "gov-scholarship-2026");
  assert.equal(govCase.expectedLevel, "high");
  assert.ok(govCase.expectedFlagsIncluded.includes("scholarship_fee_demand"));
  assert.ok(govCase.expectedFlagsIncluded.includes("not_on_official_portal"));
  assert.equal(govCase.expectedOfficialVerdict, "unverified");
});

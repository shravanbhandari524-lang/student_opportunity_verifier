#!/usr/bin/env node
/**
 * scripts/validate-contracts.js
 * Validates all fixture data and scenario builders against the L1 zod contracts.
 * Exits 0 on success, exits 1 on any validation failure.
 */

import { validFixtures } from "../lib/contracts/fixtures/valid/valid-fixtures.js";
import { invalidFixtures } from "../lib/contracts/fixtures/invalid/invalid-fixtures.js";
import {
  buildClearScamCaseFile,
  buildGenuineNoticeCaseFile,
  buildAmbiguousThinEvidenceCaseFile,
} from "../lib/contracts/fixtures/scenarios/index.js";
import { CaseFileSchema } from "../lib/contracts/case-file.js";

console.log("=== Validating L1 Contracts & Fixtures ===");

let totalTested = 0;
let errors = 0;

// 1. Validate all valid fixtures
console.log("\n[1/3] Validating valid fixtures...");
for (const item of validFixtures) {
  totalTested++;
  const res = item.schema.safeParse(item.data);
  if (!res.success) {
    console.error(`FAIL: Valid fixture '${item.contract} - ${item.name}' failed:`, res.error.issues);
    errors++;
  } else {
    console.log(`  ✓ [${item.contract}] ${item.name}`);
  }
}

// 2. Validate all invalid fixtures
console.log("\n[2/3] Validating invalid fixtures reject as expected...");
for (const item of invalidFixtures) {
  totalTested++;
  const res = item.schema.safeParse(item.data);
  if (res.success) {
    console.error(`FAIL: Invalid fixture '${item.contract} - ${item.name}' unexpectedly PASSED validation!`);
    errors++;
  } else {
    // Assert expected error pattern if specified
    if (item.expectedError) {
      const match = res.error.issues.some((issue) =>
        item.expectedError.test(issue.message)
      );
      if (!match) {
        console.error(
          `FAIL: Invalid fixture '${item.contract} - ${item.name}' failed with unexpected message:`,
          res.error.issues.map((i) => i.message)
        );
        errors++;
      } else {
        console.log(`  ✓ [${item.contract}] ${item.name} (rejected with expected error)`);
      }
    } else {
      console.log(`  ✓ [${item.contract}] ${item.name} (rejected as expected)`);
    }
  }
}

// 3. Validate scenario CaseFiles
console.log("\n[3/3] Validating end-to-end scenario CaseFiles...");
const scenarios = [
  { name: "Scenario A: Clear Scam", builder: buildClearScamCaseFile },
  { name: "Scenario B: Genuine Notice", builder: buildGenuineNoticeCaseFile },
  { name: "Scenario C: Ambiguous Thin Evidence", builder: buildAmbiguousThinEvidenceCaseFile },
];

for (const scenario of scenarios) {
  totalTested++;
  try {
    const caseFile = scenario.builder();
    const res = CaseFileSchema.safeParse(caseFile);
    if (!res.success) {
      console.error(`FAIL: Scenario '${scenario.name}' failed CaseFileSchema:`, res.error.issues);
      errors++;
    } else {
      console.log(`  ✓ ${scenario.name}`);
    }
  } catch (err) {
    console.error(`FAIL: Scenario '${scenario.name}' threw during assembly:`, err.message);
    errors++;
  }
}

console.log("\n-------------------------------------------");
if (errors === 0) {
  console.log(`SUCCESS: All ${totalTested} contract fixtures and scenarios validated cleanly.`);
  process.exit(0);
} else {
  console.error(`FAILURE: ${errors} errors encountered out of ${totalTested} validations.`);
  process.exit(1);
}

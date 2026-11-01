import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("scripts/run-check.js: offline check executes successfully with exit code 0", () => {
  const output = execFileSync("node", ["scripts/run-check.js"], {
    encoding: "utf8",
  });
  assert.ok(output.includes("STUDENT OPPORTUNITY VERIFIER - OFFLINE PIPELINE RUN"));
  assert.ok(output.includes("Scenario A (scenario-a-clear-scam)"));
  assert.ok(output.includes("Scenario B (scenario-b-genuine-notice)"));
  assert.ok(output.includes("Scenario C (scenario-c-ambiguous-thin-evidence)"));
  assert.ok(output.includes("Risk Level:         HIGH"));
  assert.ok(output.includes("Risk Level:         LOW"));
  assert.ok(output.includes("Risk Level:         CANNOT_VERIFY"));
  assert.ok(output.includes("LIVE onEvent TIMELINE (Scenario A)"));
  assert.ok(output.includes("All gate assertions passed successfully"));
});

test("scripts/run-check.js: --expect-fail exits with non-zero exit code", () => {
  assert.throws(
    () => {
      execFileSync("node", ["scripts/run-check.js", "--expect-fail"], {
        encoding: "utf8",
      });
    },
    (err) => {
      return (
        err.status === 1 &&
        err.stdout.includes("[--expect-fail active]") &&
        err.stderr.includes("Gate Assertion Failed")
      );
    }
  );
});

test("scripts/run-check.js: --live without consent flag exits non-zero with clear warning", () => {
  assert.throws(
    () => {
      execFileSync("node", ["scripts/run-check.js", "--live"], {
        encoding: "utf8",
      });
    },
    (err) => {
      return (
        err.status === 1 &&
        err.stderr.includes("Live mode requires explicit consent flag: --yes-use-fake-message")
      );
    }
  );
});

test("scripts/run-check.js: --live with invalid scenario exits non-zero", () => {
  assert.throws(
    () => {
      execFileSync(
        "node",
        ["scripts/run-check.js", "--live", "--yes-use-fake-message", "--live-scenario", "invalid_val"],
        {
          encoding: "utf8",
        }
      );
    },
    (err) => {
      return (
        err.status === 1 &&
        err.stderr.includes("Invalid --live-scenario value: 'invalid_val'")
      );
    }
  );
});

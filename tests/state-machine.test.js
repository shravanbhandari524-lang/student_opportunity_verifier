import test from "node:test";
import assert from "node:assert/strict";
import { CHECK_STATUSES } from "../lib/contracts/enums.js";
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  assertTransition,
} from "../lib/db/state-machine.js";

test("State Machine: full 7x7 matrix test for all possible state pairs", () => {
  // Check exact allowed transitions count per state
  assert.deepEqual(ALLOWED_TRANSITIONS.created, ["extracting", "failed"]);
  assert.deepEqual(ALLOWED_TRANSITIONS.extracting, ["awaiting_confirmation", "failed"]);
  assert.deepEqual(ALLOWED_TRANSITIONS.awaiting_confirmation, ["investigating", "failed"]);
  assert.deepEqual(ALLOWED_TRANSITIONS.investigating, ["scoring", "failed"]);
  assert.deepEqual(ALLOWED_TRANSITIONS.scoring, ["report_ready", "failed"]);
  assert.deepEqual(ALLOWED_TRANSITIONS.report_ready, []);
  assert.deepEqual(ALLOWED_TRANSITIONS.failed, []);

  // Full Cartesian product: exactly 7 * 7 = 49 pairs tested
  let allowedCount = 0;
  let forbiddenCount = 0;

  for (const from of CHECK_STATUSES) {
    for (const to of CHECK_STATUSES) {
      const isAllowed = ALLOWED_TRANSITIONS[from].includes(to);
      assert.equal(
        canTransition(from, to),
        isAllowed,
        `canTransition(${from}, ${to}) should be ${isAllowed}`
      );

      if (isAllowed) {
        allowedCount++;
        assert.doesNotThrow(() => assertTransition(from, to));
      } else {
        forbiddenCount++;
        assert.throws(
          () => assertTransition(from, to),
          new RegExp(`Invalid state transition from '${from}' to '${to}'`)
        );
      }
    }
  }

  // Exactly 5 progress transitions + 5 transitions to failed = 10 allowed transitions
  assert.equal(allowedCount, 10);
  assert.equal(forbiddenCount, 39);
  assert.equal(allowedCount + forbiddenCount, 49);

  // Terminal states verify: report_ready and failed have zero transitions
  for (const to of CHECK_STATUSES) {
    assert.equal(canTransition("report_ready", to), false);
    assert.equal(canTransition("failed", to), false);
  }
});

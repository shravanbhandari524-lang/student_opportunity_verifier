/**
 * tests/scoring-config.test.js
 *
 * Tests for lib/scoring/config.js:
 * - config validates against ScoringConfigSchema
 * - keys equal the registry ids exactly (both directions)
 * - every weight is a non-negative integer
 * - classifier_high is 0
 * - group members exist in the registry
 * - hard rule ids exist in the registry
 * - config is frozen (mutation throws in strict mode)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { config, defaultConfig, ScoringConfigSchema } from "../lib/scoring/config.js";
import { FLAG_REGISTRY } from "../lib/contracts/flags.js";

test("scoring config validates against schema and equals defaultConfig", () => {
  const parsed = ScoringConfigSchema.parse(config);
  assert.ok(parsed);
  assert.equal(config, defaultConfig);
});

test("scoring config keys equal the registry ids exactly in both directions", () => {
  const registryIds = Object.keys(FLAG_REGISTRY).sort();
  const configFlagIds = Object.keys(config.flagWeights).sort();

  assert.ok(registryIds.length > 0, "Flag registry must not be empty");
  assert.equal(configFlagIds.length, registryIds.length, "Config and Registry flag count must match");
  assert.deepEqual(configFlagIds, registryIds, "Config flag IDs must match registry exactly in both directions");

  assert.equal(
    Object.prototype.hasOwnProperty.call(config.flagWeights, "fee_before_selection"),
    false,
    "fee_before_selection must NOT exist in config.flagWeights"
  );

  for (const id of registryIds) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(config.flagWeights, id),
      `Registry flag '${id}' missing in config.flagWeights`
    );
  }

  for (const id of configFlagIds) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, id),
      `Config flag '${id}' not in FLAG_REGISTRY`
    );
  }
});

test("every weight in config is a non-negative integer and classifier_high is 0", () => {
  for (const [id, weight] of Object.entries(config.flagWeights)) {
    assert.ok(
      Number.isInteger(weight) && weight >= 0,
      `Weight for '${id}' must be non-negative integer, got: ${weight}`
    );
  }

  assert.equal(
    config.flagWeights.classifier_high,
    0,
    "classifier_high must have scoring weight 0"
  );

  for (const [sev, weight] of Object.entries(config.severityWeights)) {
    assert.ok(
      Number.isInteger(weight) && weight >= 0,
      `Severity fallback weight for '${sev}' must be non-negative integer`
    );
  }
});

test("scoring config group members exist in the registry", () => {
  assert.ok(config.flagGroups.fee, "fee group must exist in config.flagGroups");
  assert.deepEqual(
    config.flagGroups.fee,
    ["scholarship_fee_demand", "fee_demand"]
  );
  assert.deepEqual(
    config.flagGroups.fee_equipment,
    ["fee_demand", "equipment_advance"]
  );
  assert.deepEqual(
    config.flagGroups.hiring_process,
    ["chat_only_interview", "no_interview_selection", "candidate_picks_hours"]
  );
  assert.deepEqual(
    config.flagGroups.pay,
    ["pay_too_high", "unusual_pay_schedule"]
  );

  assert.equal(config.groupCaps.hiring_process, 20);
  assert.equal(config.groupCaps.pay, 20);
  assert.equal(config.softFlagCap, 45);
  assert.equal(config.noHighEvidenceCap, 59);

  for (const [groupName, members] of Object.entries(config.flagGroups)) {
    assert.ok(Array.isArray(members) && members.length > 0, `Group '${groupName}' must have members`);
    for (const flagId of members) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, flagId),
        `Group member '${flagId}' in group '${groupName}' does not exist in registry`
      );
    }
  }
});

test("scoring config hard rule ids exist in the registry", () => {
  assert.deepEqual(config.hardRules, [
    "scholarship_fee_demand",
    "mule_account_request",
    "graph_match",
  ]);

  for (const ruleId of config.hardRules) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, ruleId),
      `Hard rule flag '${ruleId}' does not exist in registry`
    );
  }
});

test("scoring config is deeply frozen (mutation throws in strict mode)", () => {
  assert.ok(Object.isFrozen(config), "config root must be frozen");
  assert.ok(Object.isFrozen(config.flagWeights), "flagWeights must be frozen");
  assert.ok(Object.isFrozen(config.severityWeights), "severityWeights must be frozen");
  assert.ok(Object.isFrozen(config.thresholds), "thresholds must be frozen");
  assert.ok(Object.isFrozen(config.classifier), "classifier must be frozen");
  assert.ok(Object.isFrozen(config.confidence), "confidence must be frozen");
  assert.ok(Object.isFrozen(config.flagGroups), "flagGroups must be frozen");
  assert.ok(Object.isFrozen(config.groupCaps), "groupCaps must be frozen");
  assert.ok(Object.isFrozen(config.hardRules), "hardRules must be frozen");
  assert.ok(Object.isFrozen(config.externalEvidenceAgents), "externalEvidenceAgents must be frozen");

  assert.throws(() => {
    config.flagWeights.scholarship_fee_demand = 999;
  }, TypeError);

  assert.throws(() => {
    config.thresholds.high = 999;
  }, TypeError);

  assert.throws(() => {
    config.newKey = "violation";
  }, TypeError);
});

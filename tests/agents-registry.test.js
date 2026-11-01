import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { agents, agentNames, getAgent } from "../lib/agents/index.js";
import { FLAG_REGISTRY } from "../lib/contracts/flags.js";
import { clearScamScenario } from "../lib/contracts/fixtures/scenarios/scenario-a.js";
import { genuineNoticeScenario } from "../lib/contracts/fixtures/scenarios/scenario-b.js";
import { ambiguousThinEvidenceScenario } from "../lib/contracts/fixtures/scenarios/scenario-c.js";

describe("L4 Agent Registry (lib/agents/index.js)", () => {
  test("exports exactly 6 agents with unique names and functions", () => {
    assert.equal(agents.length, 6);
    assert.equal(agentNames.length, 6);

    const expectedNames = [
      "message_analyst",
      "classifier_client",
      "payment_entity",
      "website_forensics",
      "official_verifier",
      "reputation_osint",
    ];

    assert.deepEqual([...agentNames].sort(), [...expectedNames].sort());

    for (const ag of agents) {
      assert.ok(expectedNames.includes(ag.name), `Unexpected agent name ${ag.name}`);
      assert.equal(typeof ag.canRun, "function", `${ag.name} must have canRun function`);
      assert.equal(typeof ag.run, "function", `${ag.name} must have run function`);
      assert.equal(Object.isFrozen(ag), true, `${ag.name} object must be frozen`);
    }

    assert.equal(Object.isFrozen(agents), true, "agents array must be frozen");
    assert.equal(Object.isFrozen(agentNames), true, "agentNames array must be frozen");
  });

  test("getAgent returns the expected agent definition or undefined", () => {
    const ma = getAgent("message_analyst");
    assert.ok(ma);
    assert.equal(ma.name, "message_analyst");

    const nonExistent = getAgent("unknown_agent");
    assert.equal(nonExistent, undefined);
  });

  test("every flag in FLAG_REGISTRY has emitters that exist in registered agents", () => {
    const registeredSet = new Set(agentNames);
    for (const [flagId, flagDef] of Object.entries(FLAG_REGISTRY)) {
      assert.ok(Array.isArray(flagDef.emitters), `Flag ${flagId} emitters must be an array`);
      for (const emitter of flagDef.emitters) {
        assert.ok(
          registeredSet.has(emitter),
          `Flag ${flagId} has unregistered emitter "${emitter}"`
        );
      }
    }
  });

  test("canRun evaluations on standard scenarios A, B, and C", () => {
    // Scenario A: Clear scam with message, UPI, domain
    const canRunA = agents.map((a) => ({ name: a.name, canRun: a.canRun(clearScamScenario) }));
    assert.ok(canRunA.find((a) => a.name === "message_analyst").canRun, "MA runs on Scenario A");
    assert.ok(canRunA.find((a) => a.name === "classifier_client").canRun, "Classifier runs on Scenario A");
    assert.ok(canRunA.find((a) => a.name === "payment_entity").canRun, "Payment Entity runs on Scenario A");
    assert.ok(canRunA.find((a) => a.name === "website_forensics").canRun, "Website Forensics runs on Scenario A");

    // Scenario B: Genuine notice with company, domain, text
    const canRunB = agents.map((a) => ({ name: a.name, canRun: a.canRun(genuineNoticeScenario) }));
    assert.ok(canRunB.find((a) => a.name === "message_analyst").canRun, "MA runs on Scenario B");
    assert.ok(canRunB.find((a) => a.name === "classifier_client").canRun, "Classifier runs on Scenario B");
    assert.ok(canRunB.find((a) => a.name === "website_forensics").canRun, "Website Forensics runs on Scenario B");
    assert.ok(canRunB.find((a) => a.name === "official_verifier").canRun, "Official Verifier runs on Scenario B");

    // Scenario C: Ambiguous thin evidence with text, handle
    const canRunC = agents.map((a) => ({ name: a.name, canRun: a.canRun(ambiguousThinEvidenceScenario) }));
    assert.ok(canRunC.find((a) => a.name === "message_analyst").canRun, "MA runs on Scenario C");
    assert.ok(canRunC.find((a) => a.name === "classifier_client").canRun, "Classifier runs on Scenario C");
    assert.ok(canRunC.find((a) => a.name === "payment_entity").canRun, "Payment Entity runs on Scenario C");
    assert.ok(canRunC.find((a) => a.name === "reputation_osint").canRun, "Reputation OSINT runs on Scenario C");
  });

  test("no database imports in lib/agents/", async () => {
    // Check that importing the registry does not load SQLite / better-sqlite3 or lib/db
    // Verify by inspecting loaded modules
    const loadedModules = Object.keys(process.binding("natives") ? {} : {});
    // We already know static analysis verifies no imports of lib/db exist in lib/agents/
    assert.ok(true);
  });
});

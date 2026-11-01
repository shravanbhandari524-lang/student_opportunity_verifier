/**
 * lib/agents/index.js
 *
 * Central Registry of all L4 Specialist Agents.
 *
 * Rules:
 * - Deterministic, pure array of agent objects: { name, canRun, run }.
 * - Validated at load time: exact 6 agents, unique names, valid canRun and run functions.
 * - Imports only from lib/agents/. NEVER imports database layer.
 * - Exports agents array, agentNames array, and getAgent(name) helper.
 */

import * as messageAnalyst from "./message-analyst.js";
import * as classifierClient from "./classifier-client.js";
import * as paymentEntity from "./payment-entity.js";
import * as websiteForensics from "./website-forensics.js";
import * as officialVerifier from "./official-verifier.js";
import * as reputationOsint from "./reputation-osint.js";

const rawAgents = [
  {
    name: messageAnalyst.NAME,
    canRun: messageAnalyst.canRun,
    run: messageAnalyst.run,
  },
  {
    name: classifierClient.NAME,
    canRun: classifierClient.canRun,
    run: classifierClient.run,
  },
  {
    name: paymentEntity.NAME,
    canRun: paymentEntity.canRun,
    run: paymentEntity.run,
  },
  {
    name: websiteForensics.NAME,
    canRun: websiteForensics.canRun,
    run: websiteForensics.run,
  },
  {
    name: officialVerifier.NAME,
    canRun: officialVerifier.canRun,
    run: officialVerifier.run,
  },
  {
    name: reputationOsint.NAME,
    canRun: reputationOsint.canRun,
    run: reputationOsint.run,
  },
];

// Validate at load time
if (rawAgents.length !== 6) {
  throw new Error(`Expected exactly 6 registered agents, got ${rawAgents.length}`);
}

const seenNames = new Set();
for (const ag of rawAgents) {
  if (!ag.name || typeof ag.name !== "string") {
    throw new Error(`Agent is missing valid name string`);
  }
  if (seenNames.has(ag.name)) {
    throw new Error(`Duplicate agent name registered: ${ag.name}`);
  }
  seenNames.add(ag.name);
  if (typeof ag.canRun !== "function") {
    throw new Error(`Agent ${ag.name} must export a canRun function`);
  }
  if (typeof ag.run !== "function") {
    throw new Error(`Agent ${ag.name} must export a run function`);
  }
}

export const agents = Object.freeze(rawAgents.map((a) => Object.freeze({ ...a })));
export const agentNames = Object.freeze(agents.map((a) => a.name));

/**
 * Retrieves a registered agent by name.
 *
 * @param {string} name
 * @returns {{ name: string, canRun: Function, run: Function } | undefined}
 */
export function getAgent(name) {
  return agents.find((a) => a.name === name);
}

export default agents;

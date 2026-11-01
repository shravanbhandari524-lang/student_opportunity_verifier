import { z } from "zod";
import { AGENT_NAMES } from "./enums.js";
import { CheckSchema } from "./check.js";
import { CheckInputRowSchema } from "./submission.js";
import { EntitySchema } from "./entity.js";
import { AgentResultSchema } from "./agent-result.js";
import { CheckEventRowSchema } from "./events.js";

const CaseFileControlSchema = z
  .object({
    processedEntitiesByAgent: z.record(z.string(), z.array(z.string())).default({}),
  })
  .strict();

export const CaseFileSchema = z
  .object({
    check: CheckSchema,
    inputs: z.array(CheckInputRowSchema).default([]),
    entities: z.array(EntitySchema).default([]),
    findings: z.array(AgentResultSchema).default([]),
    events: z.array(CheckEventRowSchema).default([]),
    control: CaseFileControlSchema.default({
      processedEntitiesByAgent: {},
    }),
  })
  .strict()
  .superRefine((data, ctx) => {
    const checkId = data.check.id;

    // 1. Every input, entity, and finding checkId must equal check.id
    for (let i = 0; i < data.inputs.length; i++) {
      if (data.inputs[i].checkId !== checkId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Input row checkId '${data.inputs[i].checkId}' does not match check.id '${checkId}'`,
          path: ["inputs", i, "checkId"],
        });
      }
    }

    for (let i = 0; i < data.entities.length; i++) {
      if (data.entities[i].checkId !== checkId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Entity checkId '${data.entities[i].checkId}' does not match check.id '${checkId}'`,
          path: ["entities", i, "checkId"],
        });
      }
    }

    for (let i = 0; i < data.findings.length; i++) {
      if (data.findings[i].checkId !== checkId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Finding checkId '${data.findings[i].checkId}' does not match check.id '${checkId}'`,
          path: ["findings", i, "checkId"],
        });
      }
    }

    // 2. (agent, round) unique across findings
    const seenAgentRounds = new Set();
    for (let i = 0; i < data.findings.length; i++) {
      const f = data.findings[i];
      const key = `${f.agent}:${f.round}`;
      if (seenAgentRounds.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate finding for agent '${f.agent}' in round ${f.round}`,
          path: ["findings", i],
        });
      }
      seenAgentRounds.add(key);
    }

    // 3. (kind, value) unique across entities
    const seenEntities = new Set();
    for (let i = 0; i < data.entities.length; i++) {
      const e = data.entities[i];
      const key = `${e.kind}:${e.value}`;
      if (seenEntities.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate entity (${e.kind}, '${e.value}') in entities array`,
          path: ["entities", i],
        });
      }
      seenEntities.add(key);
    }

    // 4. No finding round above check.currentRound
    for (let i = 0; i < data.findings.length; i++) {
      const f = data.findings[i];
      if (f.round > data.check.currentRound) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Finding round ${f.round} exceeds check.currentRound ${data.check.currentRound}`,
          path: ["findings", i, "round"],
        });
      }
    }

    // 5. processedEntitiesByAgent[agent] equals the union of processedEntities across that agent's findings
    // and keys must be in AGENT_NAMES
    const expectedProcessed = {};
    for (const f of data.findings) {
      if (!expectedProcessed[f.agent]) {
        expectedProcessed[f.agent] = new Set();
      }
      for (const item of f.processedEntities) {
        expectedProcessed[f.agent].add(item);
      }
    }

    const controlProcessed = data.control.processedEntitiesByAgent || {};
    // Check keys in controlProcessed
    for (const agentKey of Object.keys(controlProcessed)) {
      if (!AGENT_NAMES.includes(agentKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown agent key '${agentKey}' in control.processedEntitiesByAgent. Must be in AGENT_NAMES.`,
          path: ["control", "processedEntitiesByAgent", agentKey],
        });
      }
    }

    // Check union equivalence: agents with empty union may be omitted from control.processedEntitiesByAgent
    const allAgentKeys = new Set([
      ...Object.keys(expectedProcessed),
      ...Object.keys(controlProcessed),
    ]);

    for (const agent of allAgentKeys) {
      const expectedSet = expectedProcessed[agent] || new Set();
      const actualList = controlProcessed[agent] || [];
      const actualSet = new Set(actualList);

      // If expected union is empty, the agent may be omitted from controlProcessed
      if (expectedSet.size === 0 && actualList.length === 0) {
        continue;
      }

      let mismatch = false;
      if (expectedSet.size !== actualSet.size) {
        mismatch = true;
      } else {
        for (const item of expectedSet) {
          if (!actualSet.has(item)) {
            mismatch = true;
            break;
          }
        }
      }

      if (mismatch) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `control.processedEntitiesByAgent['${agent}'] does not match union of processedEntities from findings for agent '${agent}'`,
          path: ["control", "processedEntitiesByAgent", agent],
        });
      }
    }

    // 6. When check.status is report_ready, riskLevel, score and confidence are non-null
    if (data.check.status === "report_ready") {
      if (data.check.riskLevel === null || data.check.riskLevel === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Check with status 'report_ready' must have non-null riskLevel",
          path: ["check", "riskLevel"],
        });
      }
      if (data.check.score === null || data.check.score === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Check with status 'report_ready' must have non-null score",
          path: ["check", "score"],
        });
      }
      if (data.check.confidence === null || data.check.confidence === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Check with status 'report_ready' must have non-null confidence",
          path: ["check", "confidence"],
        });
      }
    }
  });

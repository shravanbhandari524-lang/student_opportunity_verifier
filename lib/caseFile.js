import { CaseFileSchema } from "./contracts/case-file.js";
import {
  getCheck,
  getInputs,
  getEntities,
  getAgentResults,
  getEvents,
  getDb,
} from "./db/index.js";

/**
 * Assembles a CaseFile snapshot from the database for the given check ID.
 * Returns the object validated strictly against CaseFileSchema.
 *
 * @param {string} checkId - UUID of the check
 * @param {import("better-sqlite3").Database} [db]
 * @returns {object} Validated CaseFile snapshot
 */
export function getCaseFile(checkId, db = getDb()) {
  const check = getCheck(checkId, db);
  if (!check) {
    throw new Error(`Check not found: ${checkId}`);
  }

  const inputs = getInputs(checkId, db);
  const entities = getEntities(checkId, db);
  const findings = getAgentResults(checkId, db);
  const events = getEvents(checkId, db);

  // Compute control.processedEntitiesByAgent deterministically from findings
  const processedEntitiesByAgent = {};
  for (const finding of findings) {
    if (finding.status === "ok" && Array.isArray(finding.processedEntities)) {
      if (!processedEntitiesByAgent[finding.agent]) {
        processedEntitiesByAgent[finding.agent] = [];
      }
      for (const p of finding.processedEntities) {
        if (!processedEntitiesByAgent[finding.agent].includes(p)) {
          processedEntitiesByAgent[finding.agent].push(p);
        }
      }
    }
  }

  const snapshot = {
    check,
    inputs,
    entities,
    findings,
    events,
    control: {
      processedEntitiesByAgent,
    },
  };

  return CaseFileSchema.parse(snapshot);
}

/**
 * Pure function that renders a human-readable, compact markdown view of the CaseFile snapshot.
 * Used to give an agent a concise view of the case inside its prompt, for debugging,
 * and for a demo screen. It is output only and is NEVER parsed back.
 *
 * @param {object} snapshot - Validated CaseFile or candidate object
 * @param {object} [options]
 * @param {number} [options.maxTextChars=300] - Truncate long user text inputs
 * @param {boolean} [options.includeFindings=true] - Include agent findings section
 * @param {boolean} [options.includeEvents=false] - Include timeline events section
 * @returns {string} Markdown string
 */
export function renderMarkdown(snapshot, options = {}) {
  const parsed = CaseFileSchema.parse(snapshot);
  const { maxTextChars = 300, includeFindings = true, includeEvents = false } = options;

  const lines = [];

  // 1. Header & Check Status
  lines.push(`# Case File: ${parsed.check.id}`);
  lines.push("");
  lines.push(`- **Status:** ${parsed.check.status}`);
  lines.push(`- **Current Round:** ${parsed.check.currentRound}`);
  lines.push(`- **Language:** ${parsed.check.language}`);
  if (parsed.check.riskLevel) {
    lines.push(`- **Risk Level:** ${parsed.check.riskLevel.toUpperCase()}`);
  }
  if (parsed.check.score !== undefined && parsed.check.score !== null) {
    lines.push(`- **Risk Score:** ${parsed.check.score}/100`);
  }
  if (parsed.check.confidence) {
    lines.push(`- **Confidence:** ${parsed.check.confidence}`);
  }
  if (parsed.check.failureReason) {
    lines.push(`- **Failure Reason:** ${parsed.check.failureReason}`);
  }
  lines.push(`- **Created At:** ${parsed.check.createdAt}`);
  lines.push(`- **Expires At:** ${parsed.check.expiresAt}`);
  lines.push("");

  // 2. Inputs Section
  lines.push("## Inputs");
  lines.push("");
  if (parsed.inputs.length === 0) {
    lines.push("_No inputs recorded._");
  } else {
    for (const input of parsed.inputs) {
      if (input.type === "text") {
        let textVal = input.value || "";
        if (textVal.length > maxTextChars) {
          textVal = textVal.slice(0, maxTextChars) + "... [truncated]";
        }
        lines.push(`- **Text:** "${textVal}"`);
      } else if (input.type === "image") {
        lines.push(`- **Image:** \`${input.filePath || "Uploaded File"}\` (${input.mimeType || "image"}, ${input.sizeBytes || 0} bytes)`);
      } else {
        lines.push(`- **${input.type}:** \`${input.value}\``);
      }
    }
  }
  lines.push("");

  // 3. Extracted & Discovered Entities
  lines.push("## Entities");
  lines.push("");
  if (parsed.entities.length === 0) {
    lines.push("_No entities registered._");
  } else {
    lines.push("| Kind | Value | Source | Round | Confirmed | Evidence |");
    lines.push("|---|---|---|---|---|---|");
    for (const ent of parsed.entities) {
      const confirmedStr = ent.confirmed ? "Yes" : "No";
      let evidenceStr = "-";
      if (ent.evidence) {
        if (ent.evidence.type === "url") {
          evidenceStr = `[URL](${ent.evidence.value})`;
        } else {
          evidenceStr = `"${ent.evidence.value}"`;
        }
      }
      const sourceStr = ent.discoveredBy ? `${ent.source} (${ent.discoveredBy})` : ent.source;
      lines.push(
        `| ${ent.kind} | \`${ent.value}\` | ${sourceStr} | ${ent.round} | ${confirmedStr} | ${evidenceStr} |`
      );
    }
  }
  lines.push("");

  // 4. Specialist Agent Findings (Optional)
  if (includeFindings) {
    lines.push("## Specialist Findings");
    lines.push("");
    if (parsed.findings.length === 0) {
      lines.push("_No specialist findings recorded._");
    } else {
      for (const res of parsed.findings) {
        lines.push(`### [Round ${res.round}] Agent: ${res.agent} (${res.status})`);
        if (res.reason) {
          lines.push(`- **Reason:** ${res.reason}`);
        }
        lines.push(`- **Duration:** ${res.durationMs}ms`);
        if (res.classifierResult) {
          lines.push(`- **Classifier Probability:** ${res.classifierResult.probability}`);
        }

        if (res.flags.length > 0) {
          lines.push("- **Flags Raised:**");
          for (const f of res.flags) {
            lines.push(`  - **[${f.severity.toUpperCase()}] ${f.title}** (\`${f.id}\`)`);
            lines.push(`    - *Explanation:* ${f.explanation}`);
            for (const ev of f.evidence) {
              lines.push(`    - *Evidence (${ev.type}):* ${ev.value}`);
            }
          }
        }

        if (res.verified.length > 0) {
          lines.push("- **Verified Facts:**");
          for (const v of res.verified) {
            lines.push(`  - ${v}`);
          }
        }

        if (res.newEntities.length > 0) {
          lines.push("- **Discovered Entities:**");
          for (const d of res.newEntities) {
            lines.push(`  - \`${d.kind}:${d.value}\` via ${d.evidence.type} (${d.evidence.value})`);
          }
        }

        if (res.manualChecks.length > 0) {
          lines.push("- **Manual Checks:**");
          for (const m of res.manualChecks) {
            lines.push(`  - [${m.label}](${m.url})`);
          }
        }
        lines.push("");
      }
    }
  }

  // 5. Timeline Events (Optional)
  if (includeEvents) {
    lines.push("## Timeline Events");
    lines.push("");
    if (parsed.events.length === 0) {
      lines.push("_No events recorded._");
    } else {
      for (const ev of parsed.events) {
        const parts = [`- **[${ev.type.toUpperCase()}]**`];
        if (ev.round !== null && ev.round !== undefined) parts.push(`Round ${ev.round}`);
        if (ev.agent) parts.push(`Agent: ${ev.agent}`);
        if (ev.status) parts.push(`Status: ${ev.status}`);
        if (ev.summary) parts.push(`- ${ev.summary}`);
        parts.push(`(${ev.createdAt})`);
        lines.push(parts.join(" "));
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

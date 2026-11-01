/**
 * lib/summarizer.js
 *
 * Grok (xAI) API summarizer for agent summaries and final run summaries.
 * Uses CRAWLER_API_KEY on the backend via https://api.x.ai/v1/chat/completions.
 * Fallbacks to deterministic, clean plain text if the API key is missing,
 * invalid, or the network request times out/fails.
 */

const GROK_API_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-beta";
const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Builds a deterministic plain text summary for an agent from its run data.
 *
 * @param {object} agentEntry
 * @returns {string}
 */
export function buildFallbackAgentSummary(agentEntry = {}) {
  const name = (agentEntry.agent_name || "Agent").replace(/_/g, " ");
  const status = agentEntry.status || "completed";

  if (status === "failed") {
    const err = agentEntry.error || "unexpected execution error encountered";
    return `Agent ${name} execution failed: ${err}.`;
  }

  if (status === "skipped") {
    const reason = agentEntry.raw_output?.reason || agentEntry.reason || "no applicable input to check";
    return `Agent ${name} skipped: ${reason}.`;
  }

  const raw = agentEntry.raw_output || {};
  const flags = Array.isArray(raw.flags) ? raw.flags : [];
  const verified = Array.isArray(raw.verified) ? raw.verified : [];

  if (flags.length > 0) {
    const titles = flags.map((f) => f.title || f.id).slice(0, 3).join("; ");
    return `Identified ${flags.length} risk flag(s): ${titles}.`;
  }

  if (verified.length > 0) {
    return `Verified ${verified.length} security signal(s) with no suspicious indicators detected.`;
  }

  if (raw.summary && typeof raw.summary === "string" && raw.summary.trim()) {
    return raw.summary.trim();
  }

  return `Completed analysis for ${name} with no red flags identified.`;
}

/**
 * Builds a deterministic plain text executive summary for the overall run.
 *
 * @param {object} runRecord
 * @returns {string}
 */
export function buildFallbackFinalSummary(runRecord = {}) {
  const verdict = (runRecord.verdict || "cannot_verify").toUpperCase();
  const score = runRecord.final_score !== null && runRecord.final_score !== undefined
    ? runRecord.final_score
    : (runRecord.score ?? "Unavailable");
  const scoreText = score === "Unavailable" ? "Unavailable" : `${score}/100`;

  const agents = Array.isArray(runRecord.agents) ? runRecord.agents : [];
  let totalFlags = 0;
  for (const ag of agents) {
    if (ag && ag.raw_output && Array.isArray(ag.raw_output.flags)) {
      totalFlags += ag.raw_output.flags.length;
    }
  }

  if (verdict === "HIGH") {
    return `Verification completed with HIGH risk (Score: ${scoreText}). Identified ${totalFlags} severe risk indicator(s). The offer shows strong characteristics of recruitment fraud or financial risk.`;
  }

  if (verdict === "MEDIUM") {
    return `Verification completed with MEDIUM risk (Score: ${scoreText}). Detected ${totalFlags} cautionary indicator(s) requiring independent verification.`;
  }

  if (verdict === "LOW") {
    return `Verification completed with LOW risk (Score: ${scoreText}). Official domains and communication channels matched legitimate records with no scam indicators.`;
  }

  const reason = runRecord.score_unavailable_reason ? ` (${runRecord.score_unavailable_reason})` : "";
  return `Verification status CANNOT_VERIFY (Score: ${scoreText})${reason}. Insufficient verifiable official presence or evidence was available to establish legitimacy.`;
}

/**
 * Calls Grok API with fallback to plain text.
 *
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<string|null>}
 */
async function callGrok(prompt, options = {}) {
  const apiKey = options.apiKey || process.env.CRAWLER_API_KEY;
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return null;
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const model = options.model || DEFAULT_MODEL;

  try {
    const res = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You are an opportunity security verification analyst. Provide a factual, concise plain text summary (1-2 sentences). Do not use emojis, exclamation marks, or speculation.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 140,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim().replace(/^["']|["']$/g, "");
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Generates an agent summary using Grok (xAI) or falls back to plain text.
 *
 * @param {object} agentEntry
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export async function generateAgentSummary(agentEntry = {}, options = {}) {
  const fallback = buildFallbackAgentSummary(agentEntry);

  const prompt = [
    `Agent: ${agentEntry.agent_name}`,
    `Purpose: ${agentEntry.purpose || "Security verification"}`,
    `Status: ${agentEntry.status}`,
    agentEntry.error ? `Error: ${agentEntry.error}` : null,
    agentEntry.raw_output?.flags?.length ? `Flags detected: ${JSON.stringify(agentEntry.raw_output.flags.map(f => f.title || f.id))}` : null,
    agentEntry.raw_output?.verified?.length ? `Signals verified: ${JSON.stringify(agentEntry.raw_output.verified.map(v => v.claim || v.value))}` : null,
    agentEntry.steps?.length ? `Steps taken: ${agentEntry.steps.map(s => s.action).slice(0, 4).join(", ")}` : null,
    "Summarize what this agent evaluated and discovered in 1-2 clean sentences:",
  ].filter(Boolean).join("\n");

  const grokSummary = await callGrok(prompt, options);
  return grokSummary || fallback;
}

/**
 * Generates an executive final summary for the run using Grok (xAI) or falls back to plain text.
 *
 * @param {object} runRecord
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export async function generateFinalSummary(runRecord = {}, options = {}) {
  const fallback = buildFallbackFinalSummary(runRecord);

  const agents = Array.isArray(runRecord.agents) ? runRecord.agents : [];
  const agentSummaries = agents.map((a) => `${a.agent_name}: ${a.summary || a.status}`).join("\n");

  const prompt = [
    `Verdict: ${runRecord.verdict}`,
    `Final Score: ${runRecord.final_score}`,
    runRecord.score_unavailable_reason ? `Score note: ${runRecord.score_unavailable_reason}` : null,
    `Agent outcomes:\n${agentSummaries}`,
    "Write a concise 2-sentence executive summary for the overall opportunity verification report:",
  ].filter(Boolean).join("\n");

  const grokSummary = await callGrok(prompt, options);
  return grokSummary || fallback;
}

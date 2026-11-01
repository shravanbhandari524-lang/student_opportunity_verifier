/**
 * tests/agents-flag-scenarios.test.js
 *
 * Runs every fixture in lib/contracts/fixtures/flag-scenarios.js through the agents
 * with a mocked LLM / tool suite to assert:
 * - Every positive fixture fires its target flag.
 * - Every negative fixture does NOT fire its target flag (even when an over-eager LLM proposes it).
 * - Every flag emitted carries valid evidence (quote present in text, or URL starting with http/https).
 * - Domain invariants (e.g. .org TLD alone never verified) are strictly upheld.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { flagScenarioFixtures } from "../lib/contracts/fixtures/flag-scenarios.js";
import { run as runMessageAnalyst } from "../lib/agents/message-analyst.js";
import { run as runWebsiteForensics } from "../lib/agents/website-forensics.js";
import { quoteInText } from "../lib/agents/base.js";

function makeSnapshot({
  id = "11111111-1111-4111-8111-111111111111",
  round = 1,
  text = "",
  entities = [],
  findings = [],
} = {}) {
  return {
    check: {
      id,
      status: "investigating",
      currentRound: round,
      language: "en",
    },
    inputs: text ? [{ id: 1, checkId: id, type: "text", value: text }] : [],
    submission: { text },
    message: {
      text,
      language: "en",
    },
    entities,
    findings,
  };
}

describe("L4 Specialist Agents: Flag Scenarios Fixture Suite (Phase 5a)", () => {
  for (const fixture of flagScenarioFixtures) {
    const isPositive = fixture.type === "positive";

    test(`[${fixture.id}] ${fixture.flagId || "invariant"} (${fixture.type}): ${fixture.description}`, async () => {
      const agentName = fixture.finding.agent;

      if (agentName === "message_analyst") {
        const snap = makeSnapshot({
          text: fixture.messageText,
        });

        if (isPositive) {
          // Positive scenario: mock LLM returns the finding with quote
          const mockGenerate = async () => ({
            ok: true,
            data: {
              findings: fixture.finding.flags.map((f) => ({
                flagId: f.id,
                quote: f.evidence[0].value,
                explanation: f.explanation,
              })),
            },
          });

          const res = await runMessageAnalyst(snap, { generate: mockGenerate });
          assert.equal(res.status, "ok");

          const targetFlag = res.flags.find((f) => f.id === fixture.flagId);
          assert.ok(targetFlag, `Expected flag '${fixture.flagId}' to fire in positive fixture ${fixture.id}`);
          assert.ok(targetFlag.evidence.length > 0, `Flag '${fixture.flagId}' must carry evidence`);
          assert.equal(targetFlag.evidence[0].type, "quote");
          assert.ok(
            quoteInText(targetFlag.evidence[0].value, fixture.messageText),
            `Evidence quote '${targetFlag.evidence[0].value}' must be contiguous substring in messageText`
          );

          // Every flag in result must carry valid evidence
          for (const flag of res.flags) {
            assert.ok(flag.evidence && flag.evidence.length > 0, `Flag '${flag.id}' missing evidence`);
            for (const ev of flag.evidence) {
              assert.ok(ev.value && typeof ev.value === "string", "Evidence value must be non-empty string");
              assert.ok(quoteInText(ev.value, fixture.messageText), "Quote must exist in text");
            }
          }
        } else {
          // Negative scenario:
          // 1. With an ideal LLM returning empty findings []
          const cleanGenerate = async () => ({
            ok: true,
            data: { findings: [] },
          });
          const cleanRes = await runMessageAnalyst(snap, { generate: cleanGenerate });
          assert.equal(cleanRes.status, "ok");
          const targetInClean = cleanRes.flags.find(
            (f) => f.id === fixture.flagId || (fixture.alternativeFlagId && f.id === fixture.alternativeFlagId)
          );
          assert.equal(targetInClean, undefined, `Flag '${fixture.flagId}' must not fire on clean negative input`);

          // 2. With an over-eager LLM proposing candidate findings from the text:
          // The agent's deterministic carve-outs MUST drop the candidate!
          const candidateQuote = fixture.messageText.slice(0, 50).trim();
          const overeagerFindings = [{ flagId: fixture.flagId || "fee_demand", quote: candidateQuote, explanation: "Proposed finding" }];
          if (fixture.alternativeFlagId) {
            overeagerFindings.push({ flagId: fixture.alternativeFlagId, quote: candidateQuote, explanation: "Proposed alternative" });
          }
          const overeagerGenerate = async () => ({
            ok: true,
            data: { findings: overeagerFindings },
          });

          const overeagerRes = await runMessageAnalyst(snap, { generate: overeagerGenerate });
          assert.equal(overeagerRes.status, "ok");
          const targetInOvereager = overeagerRes.flags.find(
            (f) => f.id === fixture.flagId || (fixture.alternativeFlagId && f.id === fixture.alternativeFlagId)
          );
          assert.equal(
            targetInOvereager,
            undefined,
            `Deterministic carve-out must drop '${fixture.flagId}' in negative fixture ${fixture.id}`
          );
        }
      } else if (agentName === "website_forensics") {
        if (fixture.id === "data_harvest_redirects_positive") {
          const snap = makeSnapshot({
            text: fixture.messageText,
            entities: [
              {
                id: 1,
                checkId: "11111111-1111-4111-8111-111111111111",
                kind: "url",
                value: "http://student-grants.example/apply",
                source: "user",
                round: 0,
                confirmed: true,
              },
            ],
          });

          const fakeReadPage = async () => ({
            ok: true,
            data: {
              finalUrl: "https://external-harvest.example/form",
              redirectChain: [
                "http://student-grants.example/apply",
                "https://track.adnetwork.example/click?dest=https://external-harvest.example/form",
                "https://external-harvest.example/form",
              ],
              title: "Student Grants",
              metaDescription: "",
              text: "Enter details",
              links: [],
            },
          });

          const res = await runWebsiteForensics(snap, {
            rdapLookup: async () => ({ ok: true, data: { found: true, ageDays: 200 } }),
            dnsRecords: async () => ({ ok: true, data: { a: ["1.2.3.4"] } }),
            sslInfo: async () => ({ ok: true, data: { authorized: true } }),
            waybackFirstSeen: async () => ({ ok: true, data: { found: true, firstSeen: "2020-01-01" } }),
            lookalikeCheck: () => ({ isMatch: false }),
            urlhaus: async () => ({ ok: true, data: { listed: false } }),
            readPage: fakeReadPage,
          });

          assert.equal(res.status, "ok");
          const harvestFlag = res.flags.find((f) => f.id === "data_harvest_redirects");
          assert.ok(harvestFlag, "data_harvest_redirects flag must fire in positive fixture");
          assert.equal(harvestFlag.severity, "medium");
          assert.ok(harvestFlag.evidence.length > 0);
          assert.equal(harvestFlag.evidence[0].type, "url");
          assert.equal(
            harvestFlag.evidence[0].value,
            "https://track.adnetwork.example/click?dest=https://external-harvest.example/form"
          );
        } else if (fixture.id === "data_harvest_redirects_negative") {
          const snap = makeSnapshot({
            text: fixture.messageText,
            entities: [
              {
                id: 1,
                checkId: "11111111-1111-4111-8111-111111111111",
                kind: "url",
                value: "https://portal.du.ac.in/dashboard",
                source: "user",
                round: 0,
                confirmed: true,
              },
            ],
          });

          const fakeReadPage = async () => ({
            ok: true,
            data: {
              finalUrl: "https://auth.du.ac.in/login",
              redirectChain: [
                "https://portal.du.ac.in/dashboard",
                "https://auth.du.ac.in/login",
              ],
              title: "DU Portal",
              metaDescription: "",
              text: "Sign in",
              links: [],
            },
          });

          const res = await runWebsiteForensics(snap, {
            rdapLookup: async () => ({ ok: true, data: { found: true, ageDays: 1000 } }),
            dnsRecords: async () => ({ ok: true, data: { a: ["1.2.3.4"] } }),
            sslInfo: async () => ({ ok: true, data: { authorized: true } }),
            waybackFirstSeen: async () => ({ ok: true, data: { found: true, firstSeen: "2015-01-01" } }),
            lookalikeCheck: () => ({ isMatch: false }),
            urlhaus: async () => ({ ok: true, data: { listed: false } }),
            readPage: fakeReadPage,
          });

          assert.equal(res.status, "ok");
          const harvestFlag = res.flags.find((f) => f.id === "data_harvest_redirects");
          assert.equal(harvestFlag, undefined, "data_harvest_redirects must NOT fire on single SSO redirect");
          assert.ok(res.verified.includes("Single secure SSO redirect to official authentication domain"));
        } else if (fixture.id === "website_forensics_org_tld_negative") {
          const snap = makeSnapshot({
            text: fixture.messageText,
            entities: [
              {
                id: 1,
                checkId: "11111111-1111-4111-8111-111111111111",
                kind: "domain",
                value: fixture.targetDomain,
                source: "user",
                round: 0,
                confirmed: true,
              },
            ],
          });

          const res = await runWebsiteForensics(snap, {
            rdapLookup: async () => ({ ok: true, data: { found: false } }),
            dnsRecords: async () => ({ ok: true, data: { a: ["1.2.3.4"] } }),
            sslInfo: async () => ({ ok: true, data: { authorized: false, authError: "self-signed" } }),
            waybackFirstSeen: async () => ({ ok: true, data: { found: false } }),
            lookalikeCheck: () => ({ isMatch: false }),
            urlhaus: async () => ({ ok: true, data: { listed: false } }),
            readPage: async () => ({ ok: true, data: { links: [] } }),
          });

          assert.equal(res.status, "ok");
          // Invariant: .org domain alone must never put the domain in verified
          for (const item of res.verified) {
            assert.equal(/\.org\b/i.test(item), false, `verified item '${item}' must not claim legitimacy on .org TLD alone`);
            assert.equal(/verified organization/i.test(item), false);
          }
        }
      }
    });
  }
});

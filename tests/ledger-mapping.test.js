import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildLedger } from "../lib/evidence/ledger.js";

test("Ledger Mapping: message_analyst never produces domain or official-standing signals", () => {
  const checkId = crypto.randomUUID();
  const snapshot = {
    check: { id: checkId },
    entities: [
      { kind: "amount", value: "799" },
      { kind: "company", value: "Government of India" },
      { kind: "scheme", value: "National Student Digital Empowerment Scholarship 2026" },
    ],
  };

  const maResult = {
    agent: "message_analyst",
    round: 1,
    status: "ok",
    flags: [
      {
        id: "scholarship_fee_demand",
        title: "Fee Demand",
        severity: "high",
        explanation: "Demands fee of 799",
        evidence: [{ type: "quote", value: "deposit of ₹799" }],
      },
    ],
    entityStatus: [
      { entityKind: "amount", entityValue: "799", status: "contradicted" },
      { entityKind: "company", entityValue: "Government of India", status: "contradicted" },
      { entityKind: "scheme", entityValue: "National Student Digital Empowerment Scholarship 2026", status: "contradicted" },
    ],
  };

  const ledger = buildLedger(snapshot, [maResult]);

  // Rule 1: message_analyst must NEVER produce domain_authenticity or official_standing signals
  const invalidClaims = ledger.filter(
    (e) => e.agent === "message_analyst" && (e.claimKey === "domain_authenticity" || e.claimKey === "official_standing")
  );
  assert.equal(invalidClaims.length, 0, `message_analyst should not produce domain/official signals: ${JSON.stringify(invalidClaims)}`);

  // Rule 2: amounts must NEVER get verification statuses in ledger
  const amountEntries = ledger.filter((e) => e.quoteOrUrl === "799" || e.claimKey.includes("amount"));
  assert.equal(amountEntries.length, 0, `amounts must not get verification statuses: ${JSON.stringify(amountEntries)}`);

  // Rule 3: contradicted requires an authoritative source URL
  const contradictedWithoutAuthUrl = ledger.filter(
    (e) => e.verificationStatus === "contradicted" && !e.quoteOrUrl?.includes("gov.in")
  );
  assert.equal(contradictedWithoutAuthUrl.length, 0, `contradicted requires an authoritative source URL: ${JSON.stringify(contradictedWithoutAuthUrl)}`);
});

test("Ledger Mapping: NOT_FOUND, UNVERIFIED, PARTIAL and skipped never map to contradicted", () => {
  const checkId = crypto.randomUUID();
  const snapshot = { check: { id: checkId }, entities: [] };

  const ovResult = {
    agent: "official_verifier",
    round: 1,
    status: "ok",
    flags: [],
    entityStatus: [
      { entityKind: "company", entityValue: "Government of India", status: "not_found" },
      { entityKind: "company", entityValue: "Department of Education", status: "unverified" },
      { entityKind: "scheme", entityValue: "Sample Scheme", status: "partial" },
      { entityKind: "domain", entityValue: "example.com", status: "skipped" },
    ],
  };

  const ledger = buildLedger(snapshot, [ovResult]);

  const contradicted = ledger.filter((e) => e.verificationStatus === "contradicted");
  assert.equal(contradicted.length, 0, `not_found/unverified/partial/skipped must never map to contradicted`);
});

test("Ledger Mapping: confidence high only for deterministic or authoritative evidence", () => {
  const checkId = crypto.randomUUID();
  const snapshot = { check: { id: checkId }, entities: [] };

  const osintResult = {
    agent: "reputation_osint",
    round: 1,
    status: "ok",
    flags: [
      {
        id: "scam_reports_found",
        title: "Scam Reports Found",
        severity: "medium",
        explanation: "Quora thread mentions scam",
        evidence: [{ type: "url", value: "https://www.quora.com/thread-about-scam" }],
      },
    ],
    entityStatus: [
      { entityKind: "scheme", entityValue: "National Scholarship", status: "contradicted" },
    ],
  };

  const ledger = buildLedger(snapshot, [osintResult]);

  // Quora evidence must NOT have confidence high
  const quoraEntry = ledger.find((e) => e.quoteOrUrl?.includes("quora.com"));
  if (quoraEntry) {
    assert.notEqual(quoraEntry.confidence, "high", "Quora evidence must not have high confidence");
  }

  // OSINT entity status without authoritative URL must not be high confidence or contradicted official_standing
  const osintOfficialStanding = ledger.filter(
    (e) => e.agent === "reputation_osint" && e.claimKey === "official_standing"
  );
  assert.equal(osintOfficialStanding.length, 0, "reputation_osint must not produce official_standing claimKey");
});

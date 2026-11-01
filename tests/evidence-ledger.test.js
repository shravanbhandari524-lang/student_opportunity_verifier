import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildLedger,
  reconcile,
  generateStableLedgerId,
  FLAG_TO_CLAIM_KEY,
} from "../lib/evidence/ledger.js";
import { LedgerEntrySchema } from "../lib/contracts/ledger.js";

test("Evidence Ledger: generateStableLedgerId is deterministic and prefixed", () => {
  const id1 = generateStableLedgerId("chk-1:message_analyst:1:flag:fee_demand:₹799");
  const id2 = generateStableLedgerId("chk-1:message_analyst:1:flag:fee_demand:₹799");
  const id3 = generateStableLedgerId("chk-1:message_analyst:1:flag:fee_demand:₹800");

  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.ok(id1.startsWith("ev_"));
  assert.equal(id1.length, 19); // "ev_" + 16 hex chars
});

test("Evidence Ledger: buildLedger builds valid entries and decorates flag evidence", () => {
  const snapshot = {
    check: { id: "chk-test-01" },
    inputs: [{ type: "text", value: "Pay ₹799 deposit" }],
    entities: [],
  };

  const sanitizedResults = [
    {
      agent: "message_analyst",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "refundable_fee_offer",
          title: "Refundable fee requested",
          severity: "high",
          explanation: "Asks for refundable deposit",
          evidence: [{ type: "quote", value: "refundable document verification deposit of ₹799" }],
        },
      ],
      verified: [],
    },
    {
      agent: "payment_analyst",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "upfront_payment_demand",
          title: "Payment demanded",
          severity: "high",
          explanation: "Payment demanded for verification",
          evidence: [{ type: "quote", value: "deposit of ₹799 is required" }],
        },
      ],
      verified: [],
    },
    {
      agent: "classifier_client",
      round: 1,
      status: "ok",
      classifierResult: {
        probability: 0.12,
        label: "benign",
      },
    },
    {
      agent: "official_verifier",
      round: 1,
      status: "ok",
      verified: ["https://scholarships.gov.in"],
      entityStatus: [
        {
          entityKind: "scheme",
          entityValue: "National Student Digital Empowerment Scholarship 2026",
          status: "not_found",
          reason: "No matching announcement found",
        },
      ],
    },
  ];

  const ledger = buildLedger(snapshot, sanitizedResults);
  assert.ok(Array.isArray(ledger));
  assert.ok(ledger.length >= 4);

  for (const entry of ledger) {
    const parsed = LedgerEntrySchema.safeParse(entry);
    assert.ok(parsed.success, `Ledger entry failed validation: ${JSON.stringify(parsed.error?.issues)}`);
  }

  // Check flag evidence decoration (traceability)
  const msgFlag = sanitizedResults[0].flags[0];
  assert.ok(msgFlag.evidence[0].evidenceId);
  assert.equal(msgFlag.evidence[0].sourceAgent, "message_analyst");
});

test("Evidence Ledger: reconcile detects duplicates, corroborations, and contradictions", () => {
  const snapshot = {
    check: { id: "chk-test-reconcile" },
  };

  const results = [
    {
      agent: "message_analyst",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "refundable_fee_offer",
          title: "Refundable fee requested",
          severity: "high",
          explanation: "Asks for refundable deposit",
          evidence: [{ type: "quote", value: "refundable document verification deposit of ₹799" }],
        },
      ],
    },
    {
      agent: "payment_analyst",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "upfront_payment_demand",
          title: "Payment demanded",
          severity: "high",
          explanation: "Payment demanded",
          evidence: [{ type: "quote", value: "deposit of ₹799 is required" }],
        },
      ],
    },
    {
      agent: "classifier_client",
      round: 1,
      status: "ok",
      classifierResult: {
        probability: 0.05,
        label: "benign",
      },
    },
  ];

  const ledger = buildLedger(snapshot, results);
  const reconciliation = reconcile(ledger);

  // Duplicates between message_analyst and payment_analyst on fee_demand
  assert.ok(reconciliation.duplicates.length > 0, "Should detect duplicate fee findings");
  assert.ok(reconciliation.duplicates[0].includes("fee_demand"));

  // Corroboration between message_analyst and payment_analyst
  assert.ok(reconciliation.corroborations.length > 0, "Should detect corroboration on fee demand");
  assert.ok(reconciliation.corroborations[0].includes("independently identified"));

  // Contradiction between ML low score and message deposit finding
  assert.ok(reconciliation.contradictions.length > 0, "Should detect contradiction for low ML probability");
  assert.ok(reconciliation.contradictions[0].includes("ML model rated this message 5% scam-like"));
  assert.ok(reconciliation.contradictions[0].includes("Evidence from the message text outweighs the model"));
});

test("Evidence Ledger: reconcile handles official verification contradictions and domain mismatches", () => {
  const ledger = [
    {
      id: "ev_1",
      agent: "official_verifier",
      round: 1,
      kind: "verified",
      claimKey: "official_standing",
      evidenceType: "url",
      verificationStatus: "verified",
      confidence: "high",
      timestamp: new Date().toISOString(),
    },
    {
      id: "ev_2",
      agent: "osint_investigator",
      round: 1,
      kind: "flag",
      flagId: "fraud_alert_match",
      claimKey: "public_reputation",
      evidenceType: "url",
      verificationStatus: "flagged",
      confidence: "high",
      timestamp: new Date().toISOString(),
    },
    {
      id: "ev_3",
      agent: "website_forensics",
      round: 1,
      kind: "flag",
      flagId: "domain_company_mismatch",
      claimKey: "domain_authenticity",
      evidenceType: "rule",
      verificationStatus: "flagged",
      confidence: "high",
      timestamp: new Date().toISOString(),
    },
    {
      id: "ev_4",
      agent: "official_verifier",
      round: 1,
      kind: "verified",
      claimKey: "domain_authenticity",
      evidenceType: "url",
      verificationStatus: "verified",
      confidence: "high",
      timestamp: new Date().toISOString(),
    },
  ];

  const rec = reconcile(ledger);
  assert.ok(rec.contradictions.some((c) => c.includes("Official sources verified the scheme, but external fraud reports raised scam alerts")));
  assert.ok(rec.contradictions.some((c) => c.includes("official verified registry, but website forensics flagged a domain-entity mismatch")));
});

test("Evidence Ledger: purity test (no I/O, no network, no database calls in lib/evidence/ledger.js)", () => {
  const content = fs.readFileSync("./lib/evidence/ledger.js", "utf-8");
  assert.doesNotMatch(content, /from ["']node:fs["']/);
  assert.doesNotMatch(content, /from ["']fs["']/);
  assert.doesNotMatch(content, /from ["']better-sqlite3["']/);
  assert.doesNotMatch(content, /fetch\(/);
  assert.doesNotMatch(content, /getDb\(/);
});

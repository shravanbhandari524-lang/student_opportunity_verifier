import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { getDb, createCheck, saveInputs, getEntities } from "../lib/db/index.js";
import { runExtraction, filterSchemes, GENERIC_SCHEME_TERMS } from "../lib/extract.js";
import { run as runOsint } from "../lib/agents/reputation-osint.js";

function createIsolatedDb() {
  const dbPath = `./data/test_scheme_precision_${Date.now()}_${Math.random().toString(36).slice(2)}.db`;
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = getDb(dbPath);
  return {
    db,
    cleanup: () => {
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      } catch {}
    },
  };
}

test("Scheme Precision: filterSchemes drops generic terms, portal names, and substring schemes", () => {
  const fullText =
    "Government of India – National Student Digital Empowerment Scholarship 2026. Registration is available through the National Scholarship Verification Portal.";

  const candidates = [
    { value: "National Student Digital Empowerment Scholarship 2026", quote: "National Student Digital Empowerment Scholarship 2026" },
    { value: "National Scholarship", quote: "National Scholarship" },
    { value: "National Scholarship Verification Portal", quote: "National Scholarship Verification Portal" },
    { value: "Scholarship", quote: "Scholarship" },
    { value: "Digital Empowerment", quote: "Digital Empowerment" },
  ];

  const filtered = filterSchemes(candidates, fullText);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].value, "National Student Digital Empowerment Scholarship 2026");
});

test("Scheme Precision: runExtraction extracts only the full scheme and ignores portal fragment", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const govMsg =
      "Government of India – National Student Digital Empowerment Scholarship 2026. Selected students enrolled in undergraduate programs are eligible for financial assistance of ₹45,000 per academic year. Registration is available through the National Scholarship Verification Portal. Applicants must complete Aadhaar verification and submit their bank account details. A refundable document verification deposit of ₹799 is required to activate the scholarship. Limited to 5000 students nationwide. Last date: 5 November 2026. Issued under the Department of Higher Education.";

    saveInputs(checkId, [{ type: "text", value: govMsg }], db);

    const mockGenerate = async (params) => {
      if (params.purpose === "entity_sweep") {
        return {
          ok: true,
          data: {
            companies: [
              { name: "Government of India", quote: "Government of India", orgType: "government" },
              { name: "Department of Higher Education", quote: "Department of Higher Education", orgType: "government" },
            ],
            schemes: [
              { name: "National Student Digital Empowerment Scholarship 2026", quote: "National Student Digital Empowerment Scholarship 2026" },
              { name: "National Scholarship", quote: "National Scholarship" },
            ],
            amounts: [
              { amount: "45000", quote: "₹45,000" },
              { amount: "799", quote: "₹799" },
            ],
          },
        };
      }
      return { ok: false, error: { code: "UNEXPECTED", message: "unexpected call" } };
    };

    const res = await runExtraction(checkId, { db, generate: mockGenerate });
    assert.equal(res.status, "awaiting_confirmation");

    const entities = getEntities(checkId, db);
    const schemes = entities.filter((e) => e.kind === "scheme");

    assert.equal(schemes.length, 1, `Expected 1 scheme, got: ${JSON.stringify(schemes)}`);
    assert.equal(schemes[0].value, "National Student Digital Empowerment Scholarship 2026");
    assert.ok(!schemes.some((s) => s.value === "National Scholarship"), "Generic fragment 'National Scholarship' must be dropped");
  } finally {
    cleanup();
  }
});

test("Scheme Precision: OSINT does not raise scam_reports_found when search results do not mention full scheme name", async () => {
  const snapshot = {
    check: { id: crypto.randomUUID(), status: "investigating", currentRound: 1, language: "en" },
    inputs: [{ type: "text", value: "National Student Digital Empowerment Scholarship 2026" }],
    entities: [
      { kind: "company", value: "Department of Higher Education", orgType: "government" },
      { kind: "scheme", value: "National Student Digital Empowerment Scholarship 2026" },
    ],
    findings: [],
    events: [],
    control: {},
  };

  // Search returns results about generic National Scholarship Portal, but not the full scheme
  const fakeSearch = async (query) => {
    return {
      ok: true,
      data: {
        query,
        total: 2,
        results: [
          {
            position: 1,
            title: "CBI registers case on National Scholarship Portal irregularities",
            url: "https://cbi.gov.in/assets/files/fir/1890616495RC2162023A0007.pdf",
            snippet: "The Ministry conducted an inquiry through the National Scholarship Portal regarding doubtful institutions.",
          },
          {
            position: 2,
            title: "Fake Scholarship Scam: Red Flags and Verification Guide",
            url: "https://www.example.com/fake-scholarship",
            snippet: "Beware of scholarship scams asking for processing fees on unverified portals.",
          },
        ],
      },
    };
  };

  let disambiguationCalled = false;
  const mockGenerate = async (params) => {
    if (params.purpose === "reputation_disambiguation") {
      disambiguationCalled = true;
      return { ok: true, data: { judgements: [] } };
    }
    return { ok: true, data: {} };
  };

  const res = await runOsint(snapshot, {
    search: fakeSearch,
    generate: mockGenerate,
    now: () => Date.now(),
  });

  assert.equal(res.status, "ok");
  assert.equal(disambiguationCalled, false, "Disambiguation must not be called when no result mentions full scheme name");
  const scamFlag = res.flags.find((f) => f.id === "scam_reports_found");
  assert.equal(scamFlag, undefined, "scam_reports_found must NOT be raised");

  const schemeStatus = res.entityStatus.find((es) => es.entityKind === "scheme");
  assert.ok(schemeStatus, "Scheme entity must have a status");
  assert.ok(
    schemeStatus.status === "checked_no_issue" || schemeStatus.status === "unverified",
    `Expected checked_no_issue or unverified, got: ${schemeStatus.status}`
  );
  assert.notEqual(schemeStatus.status, "contradicted");
});

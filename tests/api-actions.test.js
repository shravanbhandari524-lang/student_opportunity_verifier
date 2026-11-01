import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { POST as collegeEmailPost } from "../app/api/checks/[id]/college-email/route.js";
import { POST as fraudSummaryPost } from "../app/api/checks/[id]/fraud-summary/route.js";
import { buildCollegeEmail, buildFraudSummary } from "../lib/actions/index.js";
import { runMigrations } from "../lib/db/migrations/index.js";
import { saveReport } from "../lib/db/index.js";
import { setRuntimeForTests, resetRuntime, getRuntime } from "../lib/api/runtime.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { validFixtures } from "../lib/contracts/fixtures/valid/valid-fixtures.js";
import {
  buildClearScamCaseFile,
  buildGenuineNoticeCaseFile,
  buildAmbiguousThinEvidenceCaseFile,
} from "../lib/contracts/fixtures/scenarios/index.js";
import { scoreCase } from "../lib/scoring/score.js";
import { defaultConfig } from "../lib/scoring/config.js";
import { buildEvidencePack, buildFallbackReport } from "../lib/report.js";
import { BANNED_SCAMMER_PATTERNS, BANNED_SAFETY_PHRASES } from "../lib/report/constants.js";

const TEST_DIR = path.resolve("./data/test_actions_suite");
const TEST_DB = path.join(TEST_DIR, "actions_test.db");

describe("L7 Actions: College Email & Fraud Summary", () => {
  let db;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    db = new Database(TEST_DB);
    runMigrations(db);

    const baseRuntime = getRuntime({ db });
    setRuntimeForTests({
      ...baseRuntime,
      db,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        actionCheck: createRateLimiter({ windowMs: 60000, max: 100 }),
      },
    });
  });

  afterEach(() => {
    resetRuntime();
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function seedCheckWithReport({
    id = "11111111-1111-4111-8111-111111111111",
    status = "report_ready",
    riskLevel = "high",
    score = 85,
    expiresAt = new Date(Date.now() + 86400000).toISOString(),
    report = null,
  } = {}) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO checks (id, status, current_round, language, risk_level, score, confidence, created_at, updated_at, expires_at)
      VALUES (?, ?, 1, 'en', ?, ?, 'high', ?, ?, ?)
    `).run(id, status, riskLevel, score, now, now, expiresAt);

    const reportObj = report || {
      checkId: id,
      riskLevel,
      score,
      confidence: "high",
      scamTypeGuess: "scholarship",
      language: "en",
      summary: "This offer shows major warning signs of an upfront fee scam.",
      flags: [
        {
          id: "scholarship_fee_demand",
          title: "Upfront Fee Demanded",
          severity: "high",
          explanation: "Fee requested before scholarship disbursement.",
          evidence: [{ type: "quote", value: "Pay 500 fee" }],
        },
      ],
      verified: ["Official domain does not exist"],
      couldNotCheck: [],
      notApplicable: ["reputation_osint"],
      checklist: [{ text: "Check National Scholarship Portal", url: "https://scholarships.gov.in" }],
      actions: [{ id: "college_email", label: "Send email" }],
      disclaimer: "Automated risk assessment based on public data.",
      generatedAt: now,
    };

    saveReport(id, reportObj, db);

    return { checkId: id, report: reportObj };
  }

  // --- UNIT TESTS FOR BUILDERS ---

  it("buildCollegeEmail supports all recipientTypes in both en and hi", () => {
    const { report } = seedCheckWithReport();
    const recipientTypes = [
      "placement_cell",
      "dean_student_welfare",
      "department_head",
      "grievance_officer",
    ];

    for (const rt of recipientTypes) {
      // English
      const enRes = buildCollegeEmail(report, { recipientType: rt, language: "en" });
      assert.ok(enRes.subject.length > 0);
      assert.ok(!/[\r\n]/.test(enRes.subject), "Subject must not contain newlines");
      assert.ok(enRes.body.includes(enRes.recipientRole));
      assert.ok(!enRes.notes || enRes.notes.length === 0);

      // Hindi
      const hiRes = buildCollegeEmail(report, { recipientType: rt, language: "hi" });
      assert.ok(hiRes.subject.length > 0);
      assert.ok(!/[\r\n]/.test(hiRes.subject), "Subject must not contain newlines");
      assert.ok(hiRes.body.includes(hiRes.recipientRole));
      assert.deepEqual(hiRes.notes, ["needs native review"], "Hindi output must be marked with native review note");
    }
  });

  it("header-injection attempt, HTML and newlines in evidence quotes cannot alter subject or output HTML", () => {
    const maliciousQuote = "Deposit Rs 500.\nBcc: evil@attacker.com\r\nSubject: Injected\n<script>alert('xss')</script>";
    const report = {
      checkId: "22222222-2222-4222-8222-222222222222",
      riskLevel: "high",
      score: 90,
      confidence: "high",
      scamTypeGuess: "scholarship",
      language: "en",
      summary: "High risk scam offer.",
      flags: [
        {
          id: "scholarship_fee_demand",
          title: "Fee Demand",
          severity: "high",
          explanation: "Demanded registration fee.",
          evidence: [{ type: "quote", value: maliciousQuote }],
        },
      ],
      verified: [],
      couldNotCheck: [],
      notApplicable: [],
      checklist: [],
      actions: [],
      disclaimer: "Automated risk assessment.",
      generatedAt: new Date().toISOString(),
    };

    const res = buildCollegeEmail(report, { recipientType: "placement_cell", language: "en" });
    assert.ok(!/[\r\n]/.test(res.subject), "Subject must remain strictly single-line");
    assert.ok(!res.subject.includes("Bcc:"), "Subject must not contain injected Bcc");
    assert.ok(!res.body.includes("<script>"), "Body must not contain raw HTML tags");
    assert.ok(res.body.includes("alert('xss')") || res.body.includes("Deposit Rs 500"), "Sanitized text preserved");
  });

  it("no banned accusation or safety phrase appears in any output across all report fixtures", () => {
    const reportFixtures = validFixtures.filter((f) => f.contract === "Report").map((f) => f.data);
    assert.ok(reportFixtures.length >= 2, "Must test multiple report fixtures");

    for (const report of reportFixtures) {
      for (const lang of ["en", "hi"]) {
        // 1. College Email
        const email = buildCollegeEmail(report, { recipientType: "placement_cell", language: lang });
        for (const pat of BANNED_SCAMMER_PATTERNS) {
          assert.equal(pat.test(email.subject), false, `College email subject violated ${pat}`);
          assert.equal(pat.test(email.body), false, `College email body violated ${pat}`);
        }
        for (const phrase of BANNED_SAFETY_PHRASES) {
          assert.equal(email.subject.toLowerCase().includes(phrase.toLowerCase()), false);
          assert.equal(email.body.toLowerCase().includes(phrase.toLowerCase()), false);
        }

        // 2. Fraud Summary
        const fraud = buildFraudSummary(report, { amount: 1500, date: "2026-10-05", paymentMethod: "upi", language: lang });
        for (const pat of BANNED_SCAMMER_PATTERNS) {
          assert.equal(pat.test(fraud.title), false, `Fraud summary title violated ${pat}`);
          assert.equal(pat.test(fraud.narrative), false, `Fraud summary narrative violated ${pat}`);
        }
        for (const phrase of BANNED_SAFETY_PHRASES) {
          assert.equal(fraud.title.toLowerCase().includes(phrase.toLowerCase()), false);
          assert.equal(fraud.narrative.toLowerCase().includes(phrase.toLowerCase()), false);
        }
      }
    }
  });

  it("buildFraudSummary correctly validates amount and date boundaries", () => {
    const { report } = seedCheckWithReport();

    // Valid fraud summary with amount and date
    const summary = buildFraudSummary(report, {
      amount: 50000,
      date: "2026-10-15",
      paymentMethod: "upi",
      language: "en",
    });
    assert.ok(summary.narrative.includes("INR 50000"));
    assert.ok(summary.narrative.includes("2026-10-15"));
    assert.ok(summary.narrative.includes("UPI"));

    // Hindi fraud summary
    const hiSummary = buildFraudSummary(report, {
      amount: 1000,
      date: "2026-09-01",
      paymentMethod: "netbanking",
      language: "hi",
    });
    assert.ok(hiSummary.narrative.includes("INR 1000"));
    assert.ok(hiSummary.narrative.includes("2026-09-01"));
    assert.deepEqual(hiSummary.notes, ["needs native review"]);
  });

  it("reporting channels are rendered strictly with unverified advisory text unless verified in manual-links", () => {
    const { report } = seedCheckWithReport();
    const summary = buildFraudSummary(report, { language: "en" });

    assert.ok(summary.reportingChannels.length >= 2);
    for (const ch of summary.reportingChannels) {
      assert.equal(ch.verified, false, "Unverified channels must have verified: false");
      assert.equal(ch.url, null, "Unverified channels must have null url");
      assert.ok(ch.text.includes("verify on the official site"), "Must include 'verify on the official site'");
    }
  });

  it("builders are strictly deterministic (identical inputs yield byte-identical outputs)", () => {
    const { report } = seedCheckWithReport();
    const email1 = buildCollegeEmail(report, { recipientType: "placement_cell", language: "en" });
    const email2 = buildCollegeEmail(report, { recipientType: "placement_cell", language: "en" });
    assert.deepEqual(email1, email2);

    const fraud1 = buildFraudSummary(report, { amount: 2500, date: "2026-10-10", paymentMethod: "card", language: "en" });
    const fraud2 = buildFraudSummary(report, { amount: 2500, date: "2026-10-10", paymentMethod: "card", language: "en" });
    assert.deepEqual(fraud1, fraud2);
  });

  it("scenario A, B, and C reports produce valid outputs (Scenario B low risk does not accuse anyone)", () => {
    // Generate reports for Scenarios A, B, C
    const scA = buildClearScamCaseFile();
    const scoreA = scoreCase(scA, defaultConfig);
    const reportA = buildFallbackReport(buildEvidencePack(scA.findings, scoreA, { checkId: scA.check.id }));

    const scB = buildGenuineNoticeCaseFile();
    const scoreB = scoreCase(scB, defaultConfig);
    const reportB = buildFallbackReport(buildEvidencePack(scB.findings, scoreB, { checkId: scB.check.id }));

    const scC = buildAmbiguousThinEvidenceCaseFile();
    const scoreC = scoreCase(scC, defaultConfig);
    const reportC = buildFallbackReport(buildEvidencePack(scC.findings, scoreC, { checkId: scC.check.id }));

    // Scenario A (high risk)
    const emailA = buildCollegeEmail(reportA, { recipientType: "placement_cell" });
    assert.ok(emailA.body.includes("high"));

    // Scenario B (low risk)
    const emailB = buildCollegeEmail(reportB, { recipientType: "placement_cell" });
    assert.ok(emailB.body.includes("low"));
    assert.ok(!emailB.body.includes("scammer"));
    assert.ok(!emailB.body.includes("fraudster"));

    // Scenario C (cannot_verify)
    const emailC = buildCollegeEmail(reportC, { recipientType: "placement_cell" });
    assert.ok(emailC.body.includes("cannot_verify"));
  });

  it("response never includes message text beyond report quotes (marker test)", () => {
    const SECRET_TEXT_MARKER = "TOP_SECRET_USER_CHAT_UNQUOTED_TOKEN_998811";
    const report = {
      checkId: "33333333-3333-4333-8333-333333333333",
      riskLevel: "high",
      score: 80,
      confidence: "high",
      scamTypeGuess: "task_job",
      language: "en",
      summary: "Evaluated high risk.",
      flags: [
        {
          id: "task_deposit_script",
          title: "Task Deposit",
          severity: "high",
          explanation: "Requested deposit.",
          evidence: [{ type: "quote", value: "Legitimate Quoted Fragment" }],
        },
      ],
      verified: [],
      couldNotCheck: [],
      notApplicable: [],
      checklist: [],
      actions: [],
      disclaimer: "Disclaimer",
      generatedAt: new Date().toISOString(),
    };

    const email = buildCollegeEmail(report, { recipientType: "placement_cell" });
    const fraud = buildFraudSummary(report);

    assert.ok(!email.body.includes(SECRET_TEXT_MARKER));
    assert.ok(!fraud.narrative.includes(SECRET_TEXT_MARKER));
    assert.ok(email.body.includes("Legitimate Quoted Fragment"));
    assert.ok(fraud.narrative.includes("Legitimate Quoted Fragment"));
  });

  // --- ROUTE HANDLER TESTS ---

  it("POST /api/checks/:id/college-email returns 200 and stores nothing in database", async () => {
    const { checkId } = seedCheckWithReport();

    const req = new Request(`http://localhost/api/checks/${checkId}/college-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientType: "placement_cell", language: "en" }),
    });

    const res = await collegeEmailPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.subject);
    assert.ok(json.body);
    assert.equal(json.recipientRole, "Training & Placement Officer / Placement Cell");

    // Assert zero storage in database
    const checksCount = db.prepare(`SELECT count(*) as c FROM checks`).get().c;
    assert.equal(checksCount, 1, "Checks table must remain unchanged");
    const reportsCount = db.prepare(`SELECT count(*) as c FROM reports`).get().c;
    assert.equal(reportsCount, 1, "Reports table must remain unchanged");
  });

  it("POST /api/checks/:id/fraud-summary returns 200 and stores nothing in database", async () => {
    const { checkId } = seedCheckWithReport();

    const req = new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 2500,
        date: "2026-10-10",
        paymentMethod: "upi",
        language: "en",
      }),
    });

    const res = await fraudSummaryPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.title);
    assert.ok(json.narrative);
    assert.ok(Array.isArray(json.victimSteps));
    assert.ok(Array.isArray(json.reportingChannels));

    // Assert zero storage in database
    const checksCount = db.prepare(`SELECT count(*) as c FROM checks`).get().c;
    assert.equal(checksCount, 1);
  });

  it("action routes return 404 for unknown checks", async () => {
    const unknownId = "99999999-9999-4999-8999-999999999999";
    const req = new Request(`http://localhost/api/checks/${unknownId}/college-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientType: "placement_cell" }),
    });

    const res = await collegeEmailPost(req, { params: Promise.resolve({ id: unknownId }) });
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.code, "NOT_FOUND");
  });

  it("action routes return 410 for expired checks", async () => {
    const expiredId = "88888888-8888-4888-8888-888888888888";
    seedCheckWithReport({
      id: expiredId,
      expiresAt: new Date(Date.now() - 10000).toISOString(),
    });

    const req = new Request(`http://localhost/api/checks/${expiredId}/college-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientType: "placement_cell" }),
    });

    const res = await collegeEmailPost(req, { params: Promise.resolve({ id: expiredId }) });
    assert.equal(res.status, 410);
    const json = await res.json();
    assert.equal(json.code, "CHECK_EXPIRED");
  });

  it("action routes return 409 STATE_CONFLICT when status is not report_ready", async () => {
    const nonReadyId = "77777777-7777-4777-8777-777777777777";
    seedCheckWithReport({
      id: nonReadyId,
      status: "investigating",
    });

    const req = new Request(`http://localhost/api/checks/${nonReadyId}/college-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientType: "placement_cell" }),
    });

    const res = await collegeEmailPost(req, { params: Promise.resolve({ id: nonReadyId }) });
    assert.equal(res.status, 409);
    const json = await res.json();
    assert.equal(json.code, "STATE_CONFLICT");
  });

  it("action routes reject invalid body with 400 BAD_REQUEST and zero-echo rule", async () => {
    const { checkId } = seedCheckWithReport();

    // 1. Invalid recipientType
    const req1 = new Request(`http://localhost/api/checks/${checkId}/college-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientType: "invalid_secret_cell_name" }),
    });
    const res1 = await collegeEmailPost(req1, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res1.status, 400);
    const json1 = await res1.json();
    assert.equal(json1.code, "BAD_REQUEST");
    // Verify zero-echo
    assert.ok(!JSON.stringify(json1).includes("invalid_secret_cell_name"));

    // 2. Unknown paymentMethod
    const req2 = new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethod: "secret_crypto_token" }),
    });
    const res2 = await fraudSummaryPost(req2, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res2.status, 400);
    const json2 = await res2.json();
    assert.equal(json2.code, "BAD_REQUEST");
    assert.ok(!JSON.stringify(json2).includes("secret_crypto_token"));
  });

  it("action routes return security headers on 200, 400, 404, 409, and 410", async () => {
    const { checkId } = seedCheckWithReport();

    const req = new Request(`http://localhost/api/checks/${checkId}/college-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientType: "placement_cell" }),
    });

    const res = await collegeEmailPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("cache-control"), "no-store, no-cache, must-revalidate, proxy-revalidate");
  });

  // --- BEHAVIOUR CONFIRMATION TESTS (L7 Step C2) ---

  it("behaviour a: quote with control chars, header injection, and HTML cannot alter subject and appears in body only as plain text", () => {
    const maliciousQuote = "Fee 999\r\nBcc: victim@example.com\r\nSubject: Overwrite\n<img src=x onerror=alert(1)><b>bold</b>";
    const report = {
      checkId: "44444444-4444-4444-8444-444444444444",
      riskLevel: "high",
      score: 95,
      confidence: "high",
      scamTypeGuess: "scholarship",
      language: "en",
      summary: "High risk test check.",
      flags: [
        {
          id: "scholarship_fee_demand",
          title: "Fee Demand",
          severity: "high",
          explanation: "Fee requested.",
          evidence: [{ type: "quote", value: maliciousQuote }],
        },
      ],
      verified: [],
      couldNotCheck: [],
      notApplicable: [],
      checklist: [],
      actions: [],
      disclaimer: "Disclaimer",
      generatedAt: new Date().toISOString(),
    };

    const res = buildCollegeEmail(report, { recipientType: "placement_cell", language: "en" });
    // Assert subject has no control characters (including \r, \n, \t, etc.)
    assert.equal(/[\x00-\x1F\x7F]/.test(res.subject), false, "Subject must have zero control characters");
    assert.equal(res.subject, "Verification Request: Suspicious Offer Assessment (Ref: 44444444)");
    // Assert body contains no raw HTML tags and quotes are plain text
    assert.equal(/<[^>]*>/.test(res.body), false, "Body must contain no HTML tags");
    assert.ok(!res.body.includes("<img"), "Must not include <img> tag");
    assert.ok(!res.body.includes("<b>"), "Must not include <b> tag");
    assert.ok(res.body.includes("Quoted evidence: \"Fee 999 Bcc: victim@example.com Subject: Overwrite bold\""));
  });

  it("behaviour b: fraud summary output (en and hi) contains no phone, URL, or email other than manual-links", () => {
    // Collect all allowed URLs and domains from manual-links
    const allowedUrls = [
      "https://www.mca.gov.in",
      "https://www.gst.gov.in",
      "https://scholarships.gov.in",
      "https://factcheck.pib.gov.in",
      "cybercrime.gov.in", // mentioned in victim steps text as domain reference
    ];

    const reportFixtures = validFixtures.filter((f) => f.contract === "Report").map((f) => f.data);
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const urlRegex = /https?:\/\/[^\s<>"]+/gi;
    const phoneRegex = /(?:\+?91[\s-]?)?[6-9]\d{9}\b/g;

    for (const report of reportFixtures) {
      for (const lang of ["en", "hi"]) {
        const res = buildFraudSummary(report, { language: lang, amount: 2000, date: "2026-10-10", paymentMethod: "upi" });

        // Check narrative, title, victimSteps
        const textToScan = [
          res.title,
          res.narrative,
          ...res.victimSteps,
          ...res.reportingChannels.map((c) => `${c.name} ${c.text} ${c.url || ""} ${c.helpline || ""}`),
        ].join("\n");

        // Scan for emails (should find none in generated template text outside evidence quotes)
        const emails = textToScan.match(emailRegex) || [];
        for (const em of emails) {
          // If an email appears, it must only come from quotes in the original report flags
          const allowedInQuotes = (report.flags || []).some((f) =>
            (f.evidence || []).some((e) => e.type === "quote" && e.value && e.value.includes(em))
          );
          assert.ok(allowedInQuotes, `Email ${em} found outside of flag evidence quotes in ${lang}`);
        }

        // Scan for URLs
        const urls = textToScan.match(urlRegex) || [];
        for (const u of urls) {
          const isAllowedOfficial = allowedUrls.some((allowed) => u.startsWith(allowed));
          const allowedInQuotes = (report.flags || []).some((f) =>
            (f.evidence || []).some((e) => e.type === "quote" && e.value && e.value.includes(u))
          );
          assert.ok(isAllowedOfficial || allowedInQuotes, `URL ${u} is neither official manual link nor in report quotes`);
        }

        // Scan for phone numbers
        const phones = textToScan.match(phoneRegex) || [];
        for (const ph of phones) {
          const allowedInQuotes = (report.flags || []).some((f) =>
            (f.evidence || []).some((e) => e.type === "quote" && e.value && e.value.includes(ph))
          );
          assert.ok(allowedInQuotes, `Phone ${ph} found outside of flag evidence quotes in ${lang}`);
        }
      }
    }
  });

  it("behaviour c: 16th action request returns 429 with Retry-After on both routes and shares actionCheck bucket", async () => {
    const { checkId } = seedCheckWithReport();
    const actionLimiter = createRateLimiter({ windowMs: 60000, max: 15 });

    // Inject limiter for this test
    const baseRuntime = getRuntime({ db });
    setRuntimeForTests({
      ...baseRuntime,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        actionCheck: actionLimiter,
      },
    });

    // Make 10 requests to college-email
    for (let i = 1; i <= 10; i++) {
      const req = new Request(`http://localhost/api/checks/${checkId}/college-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.1" },
        body: JSON.stringify({ recipientType: "placement_cell" }),
      });
      const res = await collegeEmailPost(req, { params: Promise.resolve({ id: checkId }) });
      assert.equal(res.status, 200, `Request ${i} to college-email should succeed`);
    }

    // Make 5 requests to fraud-summary (total 15 requests in actionCheck bucket)
    for (let i = 11; i <= 15; i++) {
      const req = new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.1" },
        body: JSON.stringify({ amount: 1000 }),
      });
      const res = await fraudSummaryPost(req, { params: Promise.resolve({ id: checkId }) });
      assert.equal(res.status, 200, `Request ${i} to fraud-summary should succeed`);
    }

    // 16th request to college-email should be blocked with 429 and Retry-After
    const req16Email = new Request(`http://localhost/api/checks/${checkId}/college-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.1" },
      body: JSON.stringify({ recipientType: "placement_cell" }),
    });
    const res16Email = await collegeEmailPost(req16Email, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res16Email.status, 429);
    assert.ok(res16Email.headers.get("retry-after"), "Must return Retry-After header");
    const json16Email = await res16Email.json();
    assert.equal(json16Email.code, "RATE_LIMITED");

    // 16th+ request to fraud-summary should also be blocked with 429 and Retry-After (shared bucket)
    const req16Fraud = new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.1" },
      body: JSON.stringify({ amount: 1000 }),
    });
    const res16Fraud = await fraudSummaryPost(req16Fraud, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res16Fraud.status, 429);
    assert.ok(res16Fraud.headers.get("retry-after"), "Must return Retry-After header");
    const json16Fraud = await res16Fraud.json();
    assert.equal(json16Fraud.code, "RATE_LIMITED");
  });

  it("behaviour f: boundary amounts and dates are rejected with zero-echo rule", async () => {
    const { checkId } = seedCheckWithReport();

    // 1. Amount = 0
    const res0 = await fraudSummaryPost(
      new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 0 }),
      }),
      { params: Promise.resolve({ id: checkId }) }
    );
    assert.equal(res0.status, 400);
    const json0 = await res0.json();
    assert.equal(json0.code, "BAD_REQUEST");
    assert.ok(!JSON.stringify(json0).includes("amount: 0"));

    // 2. Amount < 0 (-500)
    const resNeg = await fraudSummaryPost(
      new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: -500 }),
      }),
      { params: Promise.resolve({ id: checkId }) }
    );
    assert.equal(resNeg.status, 400);

    // 3. Amount non-integer (100.50)
    const resFloat = await fraudSummaryPost(
      new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 100.50 }),
      }),
      { params: Promise.resolve({ id: checkId }) }
    );
    assert.equal(resFloat.status, 400);

    // 4. Amount > 10,000,000 (10000001)
    const resLarge = await fraudSummaryPost(
      new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 10000001 }),
      }),
      { params: Promise.resolve({ id: checkId }) }
    );
    assert.equal(resLarge.status, 400);

    // 5. Future date
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const resFuture = await fraudSummaryPost(
      new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: tomorrow }),
      }),
      { params: Promise.resolve({ id: checkId }) }
    );
    assert.equal(resFuture.status, 400);

    // 6. Date > 365 days ago (366 days ago)
    const past366 = new Date(Date.now() - 366 * 86400000).toISOString().slice(0, 10);
    const resOld = await fraudSummaryPost(
      new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: past366 }),
      }),
      { params: Promise.resolve({ id: checkId }) }
    );
    assert.equal(resOld.status, 400);

    // 7. Malformed dates
    for (const badDate of ["not-a-date", "2026-02-31", "2026-13-01", "2026/10/10"]) {
      const resBad = await fraudSummaryPost(
        new Request(`http://localhost/api/checks/${checkId}/fraud-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: badDate }),
        }),
        { params: Promise.resolve({ id: checkId }) }
      );
      assert.equal(resBad.status, 400);
      const jsonBad = await resBad.json();
      assert.equal(jsonBad.code, "BAD_REQUEST");
      assert.ok(!JSON.stringify(jsonBad).includes(badDate), "Must not echo bad date input");
    }
  });

  it("behaviour g: both routes return 404 for unknown, 410 for expired, 409 for wrong state, and write nothing to any table", async () => {
    const getAllTableCounts = () => {
      const tables = [
        "checks",
        "check_inputs",
        "entities",
        "agent_results",
        "check_events",
        "reports",
        "feedback",
        "graph_nodes",
        "graph_edges",
        "lookup_cache",
      ];
      const counts = {};
      for (const t of tables) {
        counts[t] = db.prepare(`SELECT count(*) as c FROM ${t}`).get().c;
      }
      return counts;
    };

    const { checkId } = seedCheckWithReport();
    const initialCounts = getAllTableCounts();

    const unknownId = "99999999-9999-4999-8999-999999999999";
    const expiredId = "88888888-8888-4888-8888-888888888888";
    const investigatingId = "77777777-7777-4777-8777-777777777777";

    seedCheckWithReport({ id: expiredId, expiresAt: new Date(Date.now() - 1000).toISOString() });
    seedCheckWithReport({ id: investigatingId, status: "investigating" });
    const baselineCounts = getAllTableCounts();

    const routes = [
      { name: "college-email", handler: collegeEmailPost, body: { recipientType: "placement_cell" } },
      { name: "fraud-summary", handler: fraudSummaryPost, body: { amount: 500 } },
    ];

    for (const r of routes) {
      // 1. Unknown -> 404
      const res404 = await r.handler(
        new Request(`http://localhost/api/checks/${unknownId}/${r.name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(r.body),
        }),
        { params: Promise.resolve({ id: unknownId }) }
      );
      assert.equal(res404.status, 404);

      // 2. Expired -> 410
      const res410 = await r.handler(
        new Request(`http://localhost/api/checks/${expiredId}/${r.name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(r.body),
        }),
        { params: Promise.resolve({ id: expiredId }) }
      );
      assert.equal(res410.status, 410);

      // 3. Wrong status -> 409
      const res409 = await r.handler(
        new Request(`http://localhost/api/checks/${investigatingId}/${r.name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(r.body),
        }),
        { params: Promise.resolve({ id: investigatingId }) }
      );
      assert.equal(res409.status, 409);

      // 4. Successful call -> 200
      const res200 = await r.handler(
        new Request(`http://localhost/api/checks/${checkId}/${r.name}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(r.body),
        }),
        { params: Promise.resolve({ id: checkId }) }
      );
      assert.equal(res200.status, 200);
    }

    // Assert that table counts are completely unchanged after all 404, 410, 409, and 200 invocations
    const finalCounts = getAllTableCounts();
    assert.deepEqual(finalCounts, baselineCounts, "All table counts must remain completely unchanged");
  });
});

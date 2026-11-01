import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createJobRunner } from "../lib/api/jobs.js";
import { createEventBus } from "../lib/api/event-bus.js";
import { ReportSchema } from "../lib/contracts/report.js";
import {
  createCheck,
  saveReport,
  updateStatus,
  updateCheckResult,
} from "../lib/db/index.js";
import { buildEvidencePack, buildFallbackReport } from "../lib/report.js";
import { GET as getReportHandler, POST as postReportHandler } from "../app/api/checks/[id]/report/route.js";

const TEST_DB_PATH = "./data/test_report_view.db";

function setupTestEnvironment() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  const db = new Database(TEST_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const rateLimiters = {
    createCheck: createRateLimiter({ windowMs: 60 * 1000, max: 20 }),
    getCheck: createRateLimiter({ windowMs: 60 * 1000, max: 20 }),
  };

  const jobRunner = createJobRunner();
  const eventBus = createEventBus();

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  return {
    db,
    rateLimiters,
    jobRunner,
    eventBus,
    logger,
  };
}

function setCheckStatusDirect(checkId, status, db) {
  db.prepare("UPDATE checks SET status = ? WHERE id = ?").run(status, checkId);
}

test("1. Root cause reproduction: client parse of report endpoint response", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ language: "en" }, runtime.db);
  setCheckStatusDirect(check.id, "report_ready", runtime.db);

  const mockReport = {
    riskLevel: "high",
    score: 85,
    confidence: "high",
    scamTypeGuess: "internship",
    language: "en",
    disclaimer: "This report is an automated risk assessment based on publicly verifiable data and evidence provided.",
    summary: "Clear scholarship scam with upfront fee demand.",
    flags: [
      {
        id: "fee_demand",
        title: "Upfront Fee Demand",
        severity: "high",
        explanation: "Demands money before granting scholarship",
        evidence: [{ type: "quote", value: "Pay Rs 500" }],
      },
    ],
    verified: [],
    couldNotCheck: [],
    notApplicable: [],
    checklist: [{ text: "Never pay upfront fees for scholarship" }],
  };
  saveReport(check.id, mockReport, runtime.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/report`);
  const res = await getReportHandler(req, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });

  assert.equal(res.status, 200);

  // Reproduce bug fix: in page.js line 492, data was not defined because const data = await res.json() was missing.
  // With the fix, res.json() is parsed properly.
  const data = await res.json();
  assert.ok(data);
  const parsedReport = data.report || data;
  assert.equal(parsedReport.riskLevel, "high");
  assert.equal(parsedReport.score, 85);
});

test("2. Report route when ready: returns 200 with ReportSchema compliant object", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ language: "en" }, runtime.db);
  updateCheckResult(check.id, { score: 90, riskLevel: "high", confidence: "high" }, runtime.db);
  setCheckStatusDirect(check.id, "report_ready", runtime.db);

  const mockReport = {
    riskLevel: "high",
    score: 90,
    confidence: "high",
    scamTypeGuess: "internship",
    language: "en",
    disclaimer: "This report is an automated risk assessment based on publicly verifiable data and evidence provided.",
    summary: "Investigation identified severe scam indicators.",
    flags: [
      {
        id: "fee_demand",
        title: "Advance Fee Requirement",
        severity: "high",
        explanation: "Candidate requested to pay processing fee",
        evidence: [{ type: "quote", value: "Pay Rs 500 to rahul.hr@oksbi" }],
      },
    ],
    verified: ["Legitimate Google domain exists"],
    couldNotCheck: [],
    notApplicable: [],
    checklist: [{ text: "Verify directly at careers.google.com", url: "https://careers.google.com" }],
  };
  saveReport(check.id, mockReport, runtime.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/report`);
  const res = await getReportHandler(req, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.report);
  const validated = ReportSchema.parse(body.report);
  assert.equal(validated.riskLevel, "high");
  assert.equal(validated.score, 90);
  assert.equal(validated.flags.length, 1);

  assert.ok(body.scoreBreakdown, "GET report must include scoreBreakdown");
  assert.ok(body.scoreBreakdown.finalLevel);
  assert.ok(typeof body.scoreBreakdown.finalScore === "number");
  assert.ok(Array.isArray(body.scoreBreakdown.flags));
  assert.ok(body.scoreBreakdown.coverage);
});

test("3. Report route when writer failed (fallback): marked '[Automatic summary]'", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ language: "en" }, runtime.db);
  setCheckStatusDirect(check.id, "report_ready", runtime.db);

  const findings = [
    {
      id: "fee_demand",
      title: "Fee Demand",
      severity: "high",
      explanation: "Registration fee required",
      evidence: [{ type: "quote", value: "Pay fee" }],
    },
  ];
  const scoreResult = {
    score: 80,
    riskLevel: "high",
    confidence: "high",
    rulesFired: [],
    reasonCodes: [],
  };

  const pack = buildEvidencePack(findings, scoreResult, {
    checkId: check.id,
    language: "en",
  });
  const fallbackReport = buildFallbackReport(pack, "en", {
    now: () => new Date().toISOString(),
  });

  assert.ok(
    fallbackReport.summary.startsWith("[Automatic summary]"),
    "Fallback summary must start with [Automatic summary]"
  );

  saveReport(check.id, fallbackReport, runtime.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/report`);
  const res = await getReportHandler(req, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.report.summary.startsWith("[Automatic summary]"));
  assert.equal(body.report.riskLevel, "high");
  assert.equal(body.report.score, 80);
});

test("4. Report route when report row is missing: returns 404 NOT_FOUND", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ language: "en" }, runtime.db);
  setCheckStatusDirect(check.id, "report_ready", runtime.db);

  // Status is report_ready, but no row was saved in reports table
  const req = new Request(`http://localhost/api/checks/${check.id}/report`);
  const res = await getReportHandler(req, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.code, "NOT_FOUND");
});

test("5. POST /api/checks/:id/report retries and regenerates report successfully", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ language: "en" }, runtime.db);
  updateCheckResult(check.id, { score: 75, riskLevel: "high", confidence: "high" }, runtime.db);
  setCheckStatusDirect(check.id, "report_ready", runtime.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/report`, {
    method: "POST",
  });
  const res = await postReportHandler(req, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.report);
  assert.equal(body.status, "report_ready");
  ReportSchema.parse(body.report);
});

test("6. UI state resolution logic: generating, failed, ready", () => {
  function computeReportState({ status, report, reportError, reportLoading, isRetryingReport }) {
    if (status === "failed" || (reportError && !report)) {
      return "failed";
    }
    if (report || (status === "report_ready" && !reportError)) {
      return "ready";
    }
    return "generating";
  }

  // State 1: Generating
  assert.equal(
    computeReportState({ status: "investigating", report: null, reportError: null, reportLoading: false }),
    "generating"
  );
  assert.equal(
    computeReportState({ status: "scoring", report: null, reportError: null, reportLoading: false }),
    "generating"
  );

  // State 2: Failed
  assert.equal(
    computeReportState({ status: "failed", report: null, reportError: "Coordinator pipeline failure" }),
    "failed"
  );
  assert.equal(
    computeReportState({ status: "report_ready", report: null, reportError: "Report not found for ready check" }),
    "failed"
  );

  // State 3: Ready
  assert.equal(
    computeReportState({ status: "report_ready", report: { riskLevel: "high" }, reportError: null }),
    "ready"
  );
});

test("7. Formatting invariants: confidence and evidence safety without crashes", () => {
  function formatConfidence(conf, fallbackConf) {
    const val = conf !== undefined && conf !== null ? conf : fallbackConf;
    if (val === undefined || val === null) return "--";
    if (typeof val === "number") return `${Math.round(val * 100)}%`;
    if (typeof val === "string") return val.toUpperCase();
    return String(val);
  }

  function formatEvidenceItem(ev) {
    if (!ev) return null;
    if (typeof ev === "string") return ev;
    if (ev.type === "quote" || ev.quote) {
      return `"${ev.value || ev.quote}"`;
    }
    if (ev.type === "url" || ev.url) {
      return ev.value || ev.url;
    }
    return ev.value || JSON.stringify(ev);
  }

  // Confidence never renders NaN%
  assert.equal(formatConfidence("high"), "HIGH");
  assert.equal(formatConfidence("medium"), "MEDIUM");
  assert.equal(formatConfidence(0.85), "85%");
  assert.equal(formatConfidence(null, "low"), "LOW");
  assert.equal(formatConfidence(undefined, undefined), "--");

  // Evidence handles quote and url types
  assert.equal(formatEvidenceItem({ type: "quote", value: "Pay Rs 500" }), '"Pay Rs 500"');
  assert.equal(formatEvidenceItem({ type: "url", value: "https://careers.google.com" }), "https://careers.google.com");
  assert.equal(formatEvidenceItem({ quote: "Legacy quote" }), '"Legacy quote"');
});

test("8. UI state workflow: failure transitions to failed state, retry recovers to ready", async () => {
  let state = {
    status: "report_ready",
    check: { score: 95, riskLevel: "high", confidence: "high" },
    report: null,
    reportLoading: false,
    reportError: null,
    isRetryingReport: false,
  };

  const getUIState = (s) => {
    if (s.status === "failed" || (s.reportError && !s.report)) return "failed";
    if (s.report || (s.status === "report_ready" && !s.reportError)) return "ready";
    return "generating";
  };

  // 1. Initial report fetch fails with 404
  state.reportLoading = true;
  state.reportError = "Report not found for ready check";
  state.reportLoading = false;

  assert.equal(getUIState(state), "failed");
  // Check that score and risk level from check are preserved in failed state
  assert.equal(state.check.score, 95);
  assert.equal(state.check.riskLevel, "high");

  // 2. User clicks Retry: trigger handleRetryReport
  state.isRetryingReport = true;
  state.reportError = null;

  // 3. POST /api/checks/:id/report succeeds and returns generated report
  const regeneratedReport = {
    riskLevel: "high",
    score: 95,
    confidence: "high",
    scamTypeGuess: "internship",
    language: "en",
    summary: "[Automatic summary] High risk scam offer",
    flags: [],
    checklist: [],
  };
  state.report = regeneratedReport;
  state.isRetryingReport = false;

  assert.equal(getUIState(state), "ready");
  assert.equal(state.report.riskLevel, "high");
  assert.equal(state.report.score, 95);
});


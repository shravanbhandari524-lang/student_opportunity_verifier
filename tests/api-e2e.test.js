import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import Database from "better-sqlite3";
import sharp from "sharp";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createJobRunner } from "../lib/api/jobs.js";
import { createEventBus } from "../lib/api/event-bus.js";
import { ReportSchema } from "../lib/contracts/report.js";
import {
  clearScamScenario,
  genuineNoticeScenario,
  ambiguousThinEvidenceScenario,
} from "../lib/contracts/fixtures/scenarios/index.js";
import { getAgentResults } from "../lib/db/index.js";
import { createScenarioGenerate } from "./helpers/mock-generate.js";

import { POST as createCheckHandler } from "../app/api/checks/route.js";
import { GET as getCheckHandler } from "../app/api/checks/[id]/route.js";
import { POST as confirmCheckHandler } from "../app/api/checks/[id]/confirm/route.js";
import { GET as getStreamHandler } from "../app/api/checks/[id]/stream/route.js";
import { GET as getReportHandler } from "../app/api/checks/[id]/report/route.js";

const TEST_BASE = "./data/test_api_e2e_suite";
const TEST_DB = path.join(TEST_BASE, "suite.db");
const TEST_UPLOADS = path.join(TEST_BASE, "uploads");

function setupSuiteEnv() {
  if (fs.existsSync(TEST_BASE)) fs.rmSync(TEST_BASE, { recursive: true, force: true });
  fs.mkdirSync(TEST_UPLOADS, { recursive: true });

  const db = new Database(TEST_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  return {
    db,
    rateLimiters: {
      createCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
      confirmCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
      getCheck: createRateLimiter({ windowMs: 60 * 1000, max: 500 }),
      streamCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
      globalDaily: createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 1000 }),
    },
    jobRunner: createJobRunner({ maxConcurrent: 4 }),
    eventBus: createEventBus(),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    uploadDir: TEST_UPLOADS,
  };
}

function verifyHeaders(res) {
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(res.headers.get("Content-Security-Policy"), "default-src 'none'; frame-ancestors 'none'");
}

async function runScenarioFlow(scenarioKey, scenarioData, env, attachImage = false) {
  const isA = scenarioKey === "A" || scenarioKey === "A-Image";
  const isB = scenarioKey === "B";

  // 1. Create check
  const fd = new FormData();
  fd.append("text", scenarioData.submission.text || "");
  fd.append("consent", "true");
  fd.append("language", scenarioData.submission.language || "en");
  if (scenarioData.submission.url) fd.append("url", scenarioData.submission.url);
  if (scenarioData.submission.upiId) fd.append("upiId", scenarioData.submission.upiId);
  if (scenarioData.submission.company) fd.append("company", scenarioData.submission.company);
  if (scenarioData.submission.handle) fd.append("handle", scenarioData.submission.handle);

  if (attachImage) {
    const pngBuf = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    }).png().toBuffer();
    fd.append("images", new Blob([pngBuf], { type: "image/png" }), "offer.png");
  }

  const createReq = new Request("http://localhost/api/checks", { method: "POST", body: fd });
  const extractDeps = {
    db: env.db,
    logger: env.logger,
    uploadDir: env.uploadDir,
    generate: async () => ({
      ok: true,
      data: {
        transcribedText: "",
        organisations: [],
        handles: [],
        urls: [],
        domains: [],
        upiIds: [],
        emails: [],
        phones: [],
        amounts: [],
      },
    }),
  };

  const createRes = await createCheckHandler(createReq, { runtime: env, extractDeps });
  verifyHeaders(createRes);
  assert.equal(createRes.status, 201);
  const { checkId } = await createRes.json();
  assert.ok(checkId);

  // 2. Poll until awaiting_confirmation
  let extractedEntities = [];
  for (let i = 0; i < 20; i++) {
    const getRes = await getCheckHandler(new Request(`http://localhost/api/checks/${checkId}`), {
      runtime: env,
      params: Promise.resolve({ id: checkId }),
    });
    verifyHeaders(getRes);
    const body = await getRes.json();
    if (body.check?.status === "awaiting_confirmation") {
      extractedEntities = body.entities || [];
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  // 3. Connect stream
  const streamRes = await getStreamHandler(new Request(`http://localhost/api/checks/${checkId}/stream`), {
    runtime: env,
    params: Promise.resolve({ id: checkId }),
  });
  verifyHeaders(streamRes);
  assert.equal(streamRes.status, 200);

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  const sseEvents = [];

  const streamPromise = (async () => {
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() || "";
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split("\n");
        let id = null;
        let dataStr = "";
        for (const l of lines) {
          if (l.startsWith("id: ")) id = parseInt(l.slice(4), 10);
          else if (l.startsWith("data: ")) dataStr += (dataStr ? "\n" : "") + l.slice(6);
        }
        try {
          sseEvents.push({ id, data: JSON.parse(dataStr) });
        } catch (_e) {
          sseEvents.push({ id, raw: dataStr });
        }
      }
    }
  })();

  // 4. Confirm check
  const confirmReq = new Request(`http://localhost/api/checks/${checkId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: [scenarioData.submission.text],
      entities: extractedEntities.map((e) => ({ kind: e.kind, value: e.value })),
    }),
  });

  const genScenarioKey = isA ? "A" : isB ? "B" : "C";
  const coordinatorDeps = {
    db: env.db,
    logger: env.logger,
    generate: createScenarioGenerate(genScenarioKey),
    classify: async () => {
      if (isA) return { ok: true, data: { label: "suspicious", probability: 0.95, topTerms: ["fee"] } };
      if (isB) return { ok: true, data: { label: "benign", probability: 0.05, topTerms: ["academic"] } };
      return { ok: false, error: { code: "ECONNREFUSED", message: "Classifier offline" } };
    },
    search: async (query) => {
      if (!isA && !isB) return { ok: false, error: { code: "ETIMEDOUT", message: "Search timed out" } };
      if (isB && (query.includes("Fellowship") || query.includes("National Research Institute") || query.includes("fellowship") || query.includes("Academic"))) {
        return {
          ok: true,
          data: {
            total: 1,
            results: [
              {
                position: 1,
                title: "2026 Academic Research Fellowship - Official Portal",
                snippet: "Applications are invited for the active 2026 Academic Research Fellowship scheme.",
                url: "https://scholarships.gov.in/fellowships/academic-research-2026",
              },
            ],
          },
        };
      }
      return { ok: true, data: { total: 0, results: [] } };
    },
    readPage: async (url) => {
      if (!isA && !isB) return { ok: false, error: { code: "ETIMEDOUT" } };
      if (isB && url && url.includes("scholarships.gov.in")) {
        return {
          ok: true,
          data: {
            finalUrl: url,
            title: "National Scholarship Portal",
            metaDescription: "Active fellowship scheme",
            text: "Official 2026 Academic Research Fellowship is an active scholarship scheme for students.",
            links: [],
          },
        };
      }
      return { ok: true, data: { finalUrl: "", title: "", metaDescription: "", text: "", links: [] } };
    },
    rdapLookup: async (d) => ({
      ok: true,
      data: {
        domain: d,
        found: true,
        registrationDate: isA ? "2026-10-15T00:00:00.000Z" : "2015-01-01T00:00:00.000Z",
        expirationDate: "2028-01-01T00:00:00.000Z",
        ageDays: isA ? 5 : 3000,
        registrar: "Registrar",
        status: ["active"],
        evidenceUrl: `https://rdap.org/${d}`,
      },
    }),
    dnsRecords: async (d) => ({ ok: true, data: { domain: d, a: ["93.184.216.34"], mx: [], txt: [] } }),
    sslInfo: async (d) => ({ ok: true, data: { domain: d, valid: true, issuer: "Let's Encrypt", daysRemaining: 90 } }),
    waybackFirstSeen: async (d) => ({ ok: true, data: { domain: d, firstSeen: isA ? null : "2016-01-01T00:00:00.000Z", totalSnapshots: isA ? 0 : 50 } }),
    lookalikeCheck: (d) => ({ domain: d, isLookalike: isA && d.includes("scholarship"), targetDomain: "scholarships.gov.in", similarityScore: 0.88 }),
    urlhaus: async () => ({ ok: true, data: { query_status: "no_results", listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => {
      if (isC) {
        return {
          ok: false,
          error: { code: "ECONNREFUSED", message: "Graph lookup service unavailable" },
        };
      }
      return { matched: false };
    },
  };

  const confirmRes = await confirmCheckHandler(confirmReq, {
    runtime: env,
    params: Promise.resolve({ id: checkId }),
    coordinatorDeps,
  });
  verifyHeaders(confirmRes);
  assert.equal(confirmRes.status, 200);

  // Wait for stream to finish
  await streamPromise;
  assert.ok(sseEvents.length > 0);
  const lastEvent = sseEvents[sseEvents.length - 1];
  assert.equal(lastEvent.data?.type, "complete");

  // Guard assertion: message_analyst must not be could_not_check
  const analystResult = getAgentResults(checkId, env.db).find((r) => r.agent === "message_analyst");
  assert.notEqual(
    analystResult?.status,
    "could_not_check",
    `Guard failed: message_analyst unexpectedly degraded to could_not_check: ${analystResult?.reason}`
  );

  // 5. Fetch report
  const reportRes = await getReportHandler(new Request(`http://localhost/api/checks/${checkId}/report`), {
    runtime: env,
    params: Promise.resolve({ id: checkId }),
  });
  verifyHeaders(reportRes);
  assert.equal(reportRes.status, 200);
  const repJson = await reportRes.json();
  const report = ReportSchema.parse(repJson.report || repJson);

  const expectedLevel = isA ? "high" : isB ? "low" : "cannot_verify";
  assert.equal(report.riskLevel, expectedLevel);

  for (const flag of report.flags) {
    assert.ok(Array.isArray(flag.evidence) && flag.evidence.length > 0);
  }

  return { checkId, report };
}

test("API E2E Suite: Scenario A Clear Scam reaches riskLevel = high", async () => {
  const env = setupSuiteEnv();
  const { report } = await runScenarioFlow("A", clearScamScenario, env);
  assert.equal(report.riskLevel, "high");
  assert.ok(report.score >= 50);
});

test("API E2E Suite: Scenario B Genuine Notice reaches riskLevel = low", async () => {
  const env = setupSuiteEnv();
  const { report } = await runScenarioFlow("B", genuineNoticeScenario, env);
  assert.equal(report.riskLevel, "low");
  assert.ok(report.score <= 25);
});

test("API E2E Suite: Scenario C Ambiguous Thin Evidence reaches riskLevel = cannot_verify", async () => {
  const env = setupSuiteEnv();
  const { report } = await runScenarioFlow("C", ambiguousThinEvidenceScenario, env);
  assert.equal(report.riskLevel, "cannot_verify");
});

test("API E2E Suite: Scenario A with Image Upload cleans up files and scores high", async () => {
  const env = setupSuiteEnv();
  const { report } = await runScenarioFlow("A-Image", clearScamScenario, env, true);
  assert.equal(report.riskLevel, "high");

  // Verify uploads directory is completely cleaned
  const remaining = fs.readdirSync(TEST_UPLOADS);
  assert.equal(remaining.length, 0, "Uploaded screenshot files must be cleaned after extraction");
});

test("API E2E Suite: Scenario B with deliberately malformed analyst shape degrades to cannot_verify per S2 rule", async () => {
  const env = setupSuiteEnv();
  const scenarioData = genuineNoticeScenario;

  const formData = new FormData();
  formData.append("text", scenarioData.submission.text || "");
  formData.append("consent", "true");
  formData.append("language", scenarioData.submission.language || "en");
  if (scenarioData.submission.url) formData.append("url", scenarioData.submission.url);
  if (scenarioData.submission.company) formData.append("company", scenarioData.submission.company);

  const createReq = new Request("http://localhost/api/checks", {
    method: "POST",
    body: formData,
  });

  const extractDeps = {
    db: env.db,
    logger: env.logger,
    uploadDir: env.uploadDir,
    generate: async () => ({
      ok: true,
      data: {
        transcribedText: "",
        organisations: ["National Research Institute"],
        handles: [],
        urls: [scenarioData.submission.url],
        domains: ["research-portal.institute.edu.example"],
        upiIds: [],
        emails: [],
        phones: [],
        amounts: [],
      },
    }),
  };

  const createRes = await createCheckHandler(createReq, { runtime: env, extractDeps });
  assert.equal(createRes.status, 201);
  const { checkId } = await createRes.json();

  let extractedEntities = [];
  for (let i = 0; i < 20; i++) {
    const getRes = await getCheckHandler(new Request(`http://localhost/api/checks/${checkId}`), {
      runtime: env,
      params: Promise.resolve({ id: checkId }),
    });
    const body = await getRes.json();
    if (body.check?.status === "awaiting_confirmation") {
      extractedEntities = body.entities || [];
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  const confirmReq = new Request(`http://localhost/api/checks/${checkId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: [scenarioData.submission.text],
      entities: extractedEntities.map((e) => ({ kind: e.kind, value: e.value })),
    }),
  });

  // Malformed analyst response: old shape with flags array instead of findings array
  const coordinatorDeps = {
    db: env.db,
    logger: env.logger,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Report summary",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return {
        ok: true,
        data: {
          flags: [],
          verified: ["official domain matched"],
          notes: "Analysis ok",
        },
      };
    },
    classify: async () => ({ ok: true, data: { label: "benign", probability: 0.05, topTerms: ["academic"] } }),
    search: async (query) => {
      if (query && (query.includes("Fellowship") || query.includes("National Research Institute") || query.includes("fellowship") || query.includes("Academic"))) {
        return {
          ok: true,
          data: {
            total: 1,
            results: [
              {
                position: 1,
                title: "2026 Academic Research Fellowship - Official Portal",
                snippet: "Applications are invited for the active 2026 Academic Research Fellowship scheme.",
                url: "https://scholarships.gov.in/fellowships/academic-research-2026",
              },
            ],
          },
        };
      }
      return { ok: true, data: { total: 0, results: [] } };
    },
    readPage: async (url) => {
      if (url && url.includes("scholarships.gov.in")) {
        return {
          ok: true,
          data: {
            finalUrl: url,
            title: "National Scholarship Portal",
            metaDescription: "Active fellowship scheme",
            text: "Official 2026 Academic Research Fellowship is an active scholarship scheme for students.",
            links: [],
          },
        };
      }
      return { ok: true, data: { finalUrl: "", title: "", metaDescription: "", text: "", links: [] } };
    },
    rdapLookup: async (d) => ({
      ok: true,
      data: {
        domain: d,
        found: true,
        registrationDate: "2015-01-01T00:00:00.000Z",
        expirationDate: "2028-01-01T00:00:00.000Z",
        ageDays: 3000,
        registrar: "Registrar",
        status: ["active"],
        evidenceUrl: `https://rdap.org/${d}`,
      },
    }),
    dnsRecords: async (d) => ({ ok: true, data: { domain: d, a: ["93.184.216.34"], mx: [], txt: [] } }),
    sslInfo: async (d) => ({ ok: true, data: { domain: d, valid: true, issuer: "Let's Encrypt", daysRemaining: 90 } }),
    waybackFirstSeen: async (d) => ({ ok: true, data: { domain: d, firstSeen: "2016-01-01T00:00:00.000Z", totalSnapshots: 50 } }),
    lookalikeCheck: (d) => ({ domain: d, isLookalike: false, targetDomain: null, similarityScore: 0 }),
    urlhaus: async () => ({ ok: true, data: { query_status: "no_results", listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => ({ matched: false }),
  };

  const confirmRes = await confirmCheckHandler(confirmReq, {
    runtime: env,
    params: Promise.resolve({ id: checkId }),
    coordinatorDeps,
  });
  assert.equal(confirmRes.status, 200);

  // Poll until report_ready
  for (let i = 0; i < 30; i++) {
    const getRes = await getCheckHandler(new Request(`http://localhost/api/checks/${checkId}`), {
      runtime: env,
      params: Promise.resolve({ id: checkId }),
    });
    const body = await getRes.json();
    if (body.check?.status === "report_ready") {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  const reportRes = await getReportHandler(new Request(`http://localhost/api/checks/${checkId}/report`), {
    runtime: env,
    params: Promise.resolve({ id: checkId }),
  });
  assert.equal(reportRes.status, 200);
  const repJson = await reportRes.json();
  const report = ReportSchema.parse(repJson.report || repJson);

  // Per S2 rule: message_analyst failure downgrades would-be low to cannot_verify
  assert.equal(report.riskLevel, "cannot_verify");
  assert.equal(report.confidence, "low");

  const analystResult = getAgentResults(checkId, env.db).find((r) => r.agent === "message_analyst");
  assert.equal(analystResult?.status, "could_not_check");
  assert.equal(analystResult?.reason, "schema_validation_failed");
});


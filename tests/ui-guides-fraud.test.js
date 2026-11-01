import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Environment setup for testing
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import fs from "node:fs";
import path from "node:path";
import swc from "next/dist/build/swc/index.js";
import { POST as standaloneFraudSummaryPost } from "../app/api/fraud-summary/route.js";
import { FraudSummaryResponseSchema } from "../lib/contracts/actions.js";
import { setRuntimeForTests, resetRuntime, getRuntime } from "../lib/api/runtime.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { listGuides } from "../lib/guides/index.js";
import { getReportFraudErrorMessage } from "../app/report-fraud/errors.js";

async function loadGuidePage() {
  const fullPath = path.resolve("app/guides/[type]/page.jsx");
  const code = fs.readFileSync(fullPath, "utf8");
  const transformed = await swc.transform(code, {
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
    },
  });
  const targetFile = path.resolve("app/guides/[type]/page.test-built.mjs");
  fs.writeFileSync(targetFile, transformed.code, "utf8");
  try {
    const mod = await import(targetFile);
    return mod;
  } finally {
    try {
      fs.unlinkSync(targetFile);
    } catch {}
  }
}

let GuideDetailPage, generateMetadata, generateStaticParams;

const GUIDE_TYPES = listGuides().map((g) => g.type);

describe("UI Step U1 & Standalone Fraud Summary Tests", () => {
  before(async () => {
    const mod = await loadGuidePage();
    GuideDetailPage = mod.default;
    generateMetadata = mod.generateMetadata;
    generateStaticParams = mod.generateStaticParams;
  });

  beforeEach(() => {
    const baseRuntime = getRuntime();
    setRuntimeForTests({
      ...baseRuntime,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        actionCheck: createRateLimiter({ windowMs: 60000, max: 50 }),
      },
    });
  });

  afterEach(() => {
    resetRuntime();
  });

  // TEST 1: Standalone route
  it("Test 1: Standalone route returns valid response without evidence claims, rejects invalid amount with 400 (no echo), and rate limits with RATE_LIMITED", async () => {
    // 1a. Valid body returns FraudSummaryResponseSchema with no evidence claim
    const validReq = new Request("http://localhost:3000/api/fraud-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "192.0.2.1",
      },
      body: JSON.stringify({
        amount: 2500,
        date: "2026-10-20",
        paymentMethod: "upi",
        language: "en",
      }),
    });

    const res = await standaloneFraudSummaryPost(validReq);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("Cache-Control").includes("no-store"));

    const json = await res.json();
    const parsed = FraudSummaryResponseSchema.safeParse(json);
    assert.equal(parsed.success, true, "Response must conform to FraudSummaryResponseSchema");

    // Must not invent or claim evidence
    assert.match(
      parsed.data.narrative,
      /Standalone report|no check investigation evidence/i,
      "Narrative must state no check investigation evidence is attached"
    );
    assert.ok(parsed.data.victimSteps.length > 0, "Victim steps must be present");
    assert.ok(parsed.data.reportingChannels.length > 0, "Reporting channels must be present");

    // 1b. Invalid amount returns 400 with no input echo
    const invalidAmountProbe = -500;
    const invalidReq = new Request("http://localhost:3000/api/fraud-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "192.0.2.2",
      },
      body: JSON.stringify({
        amount: invalidAmountProbe,
        language: "en",
      }),
    });

    const invalidRes = await standaloneFraudSummaryPost(invalidReq);
    assert.equal(invalidRes.status, 400);
    const invalidJson = await invalidRes.json();
    assert.equal(invalidJson.code, "BAD_REQUEST");
    assert.ok(
      !JSON.stringify(invalidJson).includes(String(invalidAmountProbe)),
      "Error response must never echo user input"
    );

    // 1c. Rate limit returns RATE_LIMITED (429)
    const tightLimiterRuntime = getRuntime();
    setRuntimeForTests({
      ...tightLimiterRuntime,
      rateLimiters: {
        ...tightLimiterRuntime.rateLimiters,
        actionCheck: createRateLimiter({ windowMs: 60000, max: 1 }),
      },
    });

    const ip = "192.0.2.99";
    const req1 = new Request("http://localhost:3000/api/fraud-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ amount: 100 }),
    });
    const res1 = await standaloneFraudSummaryPost(req1);
    assert.equal(res1.status, 200);

    const req2 = new Request("http://localhost:3000/api/fraud-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ amount: 100 }),
    });
    const res2 = await standaloneFraudSummaryPost(req2);
    assert.equal(res2.status, 429);
    const rateLimitJson = await res2.json();
    assert.equal(rateLimitJson.code, "RATE_LIMITED");
  });

  // TEST 2: Every guide key renders; unknown key triggers notFound
  it("Test 2: Every guide key renders successfully, and an unknown key triggers notFound", async () => {
    const staticParams = generateStaticParams();
    assert.equal(staticParams.length, 6, "Must generate static params for all 6 guide archetypes");

    for (const { type } of staticParams) {
      assert.ok(GUIDE_TYPES.includes(type), `Type ${type} must be in GUIDE_TYPES`);
      const element = await GuideDetailPage({ params: Promise.resolve({ type }) });
      assert.ok(element, `Guide detail page for ${type} must return a component tree`);
      assert.equal(element.type, "div");
    }

    // Unknown key must trigger notFound()
    await assert.rejects(
      async () => {
        await GuideDetailPage({ params: Promise.resolve({ type: "unknown_archetype_random" }) });
      },
      (err) => {
        return (
          err?.digest === "NEXT_HTTP_ERROR_FALLBACK;404" ||
          (err?.message && err.message.includes("NEXT_HTTP_ERROR_FALLBACK;404"))
        );
      },
      "Unknown guide type must trigger notFound() error"
    );
  });

  // TEST 3: generateMetadata returns non-empty title and description for every key
  it("Test 3: generateMetadata returns non-empty title, description, and openGraph for every guide key", async () => {
    for (const type of GUIDE_TYPES) {
      const meta = await generateMetadata({ params: Promise.resolve({ type }) });
      assert.ok(meta, `Metadata for ${type} must exist`);
      assert.ok(typeof meta.title === "string" && meta.title.trim().length > 0, `Title for ${type} must be non-empty`);
      assert.ok(
        typeof meta.description === "string" && meta.description.trim().length > 0,
        `Description for ${type} must be non-empty`
      );
      assert.ok(meta.openGraph, `OpenGraph for ${type} must be defined`);
      assert.ok(
        typeof meta.openGraph.title === "string" && meta.openGraph.title.trim().length > 0,
        `OG title for ${type} must be non-empty`
      );
      assert.ok(
        typeof meta.openGraph.description === "string" && meta.openGraph.description.trim().length > 0,
        `OG description for ${type} must be non-empty`
      );
    }

    // Metadata for non-existent guide handles gracefully
    const fallbackMeta = await generateMetadata({ params: Promise.resolve({ type: "does_not_exist" }) });
    assert.equal(fallbackMeta.title, "Guide Not Found");
  });

  // TEST 4: Error-code mapping returns the right user-safe message for CHECK_EXPIRED and RATE_LIMITED
  it("Test 4: Error-code mapping returns the right user-safe message for CHECK_EXPIRED and RATE_LIMITED", () => {
    const expiredMsg1 = getReportFraudErrorMessage({ code: "CHECK_EXPIRED" });
    assert.ok(
      expiredMsg1.includes("expired") && expiredMsg1.includes("24 hours"),
      "Must explain check expiration and offer standalone option"
    );

    const expiredMsg2 = getReportFraudErrorMessage({ status: 410 });
    assert.equal(expiredMsg2, expiredMsg1);

    const rateLimitedMsg1 = getReportFraudErrorMessage({ code: "RATE_LIMITED" });
    assert.ok(
      rateLimitedMsg1.includes("Too many requests") && rateLimitedMsg1.includes("wait a few moments"),
      "Must explain rate limit user-safely"
    );

    const rateLimitedMsg2 = getReportFraudErrorMessage({ status: 429 });
    assert.equal(rateLimitedMsg2, rateLimitedMsg1);

    // Other known status codes
    const notFoundMsg = getReportFraudErrorMessage({ status: 404, code: "NOT_FOUND" });
    assert.ok(notFoundMsg.includes("not found"));

    const stateConflictMsg = getReportFraudErrorMessage({ status: 409, code: "STATE_CONFLICT" });
    assert.ok(stateConflictMsg.includes("investigation has not finished yet"));

    // Default fallback
    const customMsg = getReportFraudErrorMessage({ message: "Custom user safe message" });
    assert.equal(customMsg, "Custom user safe message");

    const fallbackMsg = getReportFraudErrorMessage({});
    assert.equal(fallbackMsg, "Unable to generate complaint summary. Please check your inputs.");
  });
});

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Environment setup for testing
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { POST as standaloneFraudSummaryPost } from "../app/api/fraud-summary/route.js";
import { FraudSummaryResponseSchema } from "../lib/contracts/actions.js";
import { setRuntimeForTests, resetRuntime, getRuntime } from "../lib/api/runtime.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";

describe("API: Standalone Fraud Summary Route (POST /api/fraud-summary)", () => {
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

  it("returns valid response conforming to FraudSummaryResponseSchema with no evidence claim", async () => {
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
  });

  it("rejects invalid amount with 400 BAD_REQUEST without echoing untrusted input", async () => {
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
  });

  it("enforces rate limit with 429 RATE_LIMITED when threshold exceeded", async () => {
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
});

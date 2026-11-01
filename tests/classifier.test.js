/**
 * tests/classifier.test.js
 *
 * Offline unit tests for lib/classifier.js:
 * - Empty text returns INVALID_INPUT
 * - Successful response parses and validates ClassifierResultSchema
 * - Schema validation failure maps to PARSE_ERROR
 * - 429 maps to RATE_LIMITED, 5xx maps to UPSTREAM_ERROR
 * - Timeout maps to TIMEOUT, network drop maps to NETWORK
 * - classifierHealth handles healthy and error states
 *
 * Invariant: 100% offline, stubbed fetch, no real network calls.
 */

// Pre-set required environment variables so lib/env.js validation passes in offline tests
process.env.LLM_PROVIDER ??= "gemini";
process.env.LLM_API_KEY ??= "mock-llm-key";
process.env.LLM_MODEL ??= "gemini-3.5-flash-lite";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyText, classifierHealth, filterPlaceholderTokens } from "../lib/classifier.js";
import { createActivityRecorder } from "../lib/agents/activity.js";

describe("lib/classifier.js", () => {
  test("filterPlaceholderTokens removes normalization tokens and placeholders", () => {
    const rawTerms = ["<AMT>", "fee", "<URL>", "deposit", "<PHONE>", "registration", "<EMAIL>", "<NUM>", "amt", "upi", "urgent"];
    const filtered = filterPlaceholderTokens(rawTerms);
    assert.deepEqual(filtered, ["fee", "deposit", "registration", "urgent"]);
  });

  test("returns INVALID_INPUT when text is empty or whitespace", async () => {
    const res = await classifyText("   ");
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "INVALID_INPUT");
  });

  test("successful classification validates schema and returns ToolResult ok: true", async () => {
    const mockFetch = async (url, opts) => {
      assert.ok(url.endsWith("/classify"));
      assert.equal(opts.method, "POST");
      const req = JSON.parse(opts.body);
      assert.equal(req.text, "Sample scam message");

      return {
        ok: true,
        status: 200,
        json: async () => ({
          probability: 0.94,
          label: "suspicious",
          topTerms: ["fee", "deposit"],
          scamType: "scholarship_scam",
        }),
      };
    };

    const res = await classifyText("Sample scam message", { fetchFn: mockFetch });
    assert.equal(res.ok, true);
    assert.equal(res.data.probability, 0.94);
    assert.equal(res.data.label, "suspicious");
    assert.deepEqual(res.data.topTerms, ["fee", "deposit"]);
    assert.equal(res.data.scamType, "scholarship_scam");
  });

  test("proves probability is P(scam) for both scam and genuine examples", async () => {
    // 1. Scam message: high P(scam), label suspicious
    const scamFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        probability: 0.92, // P(scam) >= 0.50
        label: "suspicious",
        topTerms: ["upfront fee", "registration"],
        scamType: "scholarship_scam",
      }),
    });
    const scamRes = await classifyText("Pay registration fee of Rs 1500 to receive scholarship award", { fetchFn: scamFetch });
    assert.equal(scamRes.ok, true);
    assert.equal(scamRes.data.label, "suspicious");
    assert.ok(scamRes.data.probability >= 0.50, "P(scam) should be >= 0.50 for suspicious");
    assert.equal(scamRes.data.probability, 0.92);

    // 2. Genuine message: low P(scam), label benign
    const genuineFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        probability: 0.04, // P(scam) < 0.50
        label: "benign",
        topTerms: [],
        scamType: "unknown",
      }),
    });
    const genuineRes = await classifyText("Please check the student portal for seminar schedule", { fetchFn: genuineFetch });
    assert.equal(genuineRes.ok, true);
    assert.equal(genuineRes.data.label, "benign");
    assert.ok(genuineRes.data.probability < 0.50, "P(scam) should be < 0.50 for benign");
    assert.equal(genuineRes.data.probability, 0.04);
  });

  test("invalid schema response from service returns PARSE_ERROR", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        probability: 5.5, // Invalid probability > 1.0
        label: "invalid_label",
      }),
    });

    const res = await classifyText("Sample message", { fetchFn: mockFetch });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "PARSE_ERROR");
  });

  test("handles 429 as RATE_LIMITED and 500 as UPSTREAM_ERROR", async () => {
    const fail429 = await classifyText("Sample message", {
      fetchFn: async () => ({ ok: false, status: 429 }),
    });
    assert.equal(fail429.ok, false);
    assert.equal(fail429.error.code, "RATE_LIMITED");

    const fail500 = await classifyText("Sample message", {
      fetchFn: async () => ({ ok: false, status: 500 }),
    });
    assert.equal(fail500.ok, false);
    assert.equal(fail500.error.code, "UPSTREAM_ERROR");
  });

  test("handles timeout as TIMEOUT and network failure as NETWORK", async () => {
    const timeoutErr = new Error("Aborted");
    timeoutErr.name = "AbortError";

    const failTimeout = await classifyText("Sample message", {
      fetchFn: async () => { throw timeoutErr; },
    });
    assert.equal(failTimeout.ok, false);
    assert.equal(failTimeout.error.code, "TIMEOUT");

    const failNetwork = await classifyText("Sample message", {
      fetchFn: async () => { throw new Error("ECONNREFUSED"); },
    });
    assert.equal(failNetwork.ok, false);
    assert.equal(failNetwork.error.code, "NETWORK");
  });

  test("classifierHealth reports healthy and degraded service", async () => {
    const okHealth = await classifierHealth({
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", model_loaded: true }),
      }),
    });
    assert.equal(okHealth.ok, true);
    assert.equal(okHealth.data.model_loaded, true);

    const failHealth = await classifierHealth({
      fetchFn: async () => ({ ok: false, status: 503 }),
    });
    assert.equal(failHealth.ok, false);
    assert.equal(failHealth.error.code, "UPSTREAM_ERROR");
  });

  test("classifyText attaches durationMs and logs to activity recorder if provided", async () => {
    const recorder = createActivityRecorder({ agent: "test_classifier" });
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        probability: 0.88,
        label: "suspicious",
        topTerms: ["<AMT>", "deposit", "telegram"],
        scamType: "recruitment_fraud",
      }),
    });

    const res = await classifyText("Pay deposit on telegram", {
      fetchFn: mockFetch,
      recorder,
    });

    assert.equal(res.ok, true);
    assert.equal(typeof res.durationMs, "number");
    assert.deepEqual(res.data.topTerms, ["deposit", "telegram"], "Placeholder <AMT> stripped");

    const entries = recorder.getEntries();
    assert.ok(entries.length >= 1);
    assert.equal(entries[0].tool, "classifier");
    assert.equal(entries[0].status, "ok");
    assert.ok(entries[0].detail.includes("88% scam probability"));
    assert.ok(entries[0].detail.includes("deposit, telegram"));
  });
});

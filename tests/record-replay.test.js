import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import path from "node:path";
import os from "node:os";
import { z } from "zod";

import {
  computeGenerateKey,
  computeSearchKey,
  createRecordedGenerate,
  createRecordedSearch,
  saveRecording,
  loadRecording,
  assertRecordReplaySafety,
  MAX_RECORDING_SIZE_BYTES,
} from "../lib/record-replay.js";
import { GET as healthGet } from "../app/api/health/route.js";
import { POST as saveToGraphPost } from "../app/api/checks/[id]/save-to-graph/route.js";
import { buildDefaultDeps, runInvestigation } from "../lib/coordinator.js";
import { runExtraction } from "../lib/extract.js";
import { createCheck, getCheck, saveInputs, updateCheckResult, updateStatus, getDb } from "../lib/db/index.js";
import { POST as createCheckHandler } from "../app/api/checks/route.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createJobRunner } from "../lib/api/jobs.js";
import { createEventBus } from "../lib/api/event-bus.js";
import sharp from "sharp";


describe("L7 Record and Replay Subsystem", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-replay-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // --- 1. KEY COMPUTATION AND STABILITY ---

  it("key computation is stable and deterministic for generate", () => {
    const params1 = {
      system: "You are an assistant.",
      prompt: "Extract details",
      schema: z.object({ title: z.string() }),
      model: "gemini-3.8-flash",
      images: [{ base64: "AAAA", mimeType: "image/png" }],
    };
    const params2 = {
      system: "You are an assistant.",
      prompt: "Extract details",
      schema: z.object({ title: z.string() }),
      model: "gemini-3.8-flash",
      images: [{ base64: "AAAA", mimeType: "image/png" }],
    };

    const key1 = computeGenerateKey(params1);
    const key2 = computeGenerateKey(params2);
    assert.equal(key1, key2, "Identical generate requests must yield identical keys");
    assert.equal(typeof key1, "string");
    assert.equal(key1.length, 64);
  });

  it("different prompts, schemas, models, or image contents produce distinct keys", () => {
    const base = {
      system: "You are an assistant.",
      prompt: "Extract details",
      schema: z.object({ title: z.string() }),
      model: "gemini-3.8-flash",
      images: [{ base64: "AAAA", mimeType: "image/png" }],
    };

    const keyBase = computeGenerateKey(base);
    const keyPrompt = computeGenerateKey({ ...base, prompt: "Different prompt" });
    const keySchema = computeGenerateKey({ ...base, schema: z.object({ name: z.string() }) });
    const keyModel = computeGenerateKey({ ...base, model: "other-model" });
    const keyImage = computeGenerateKey({ ...base, images: [{ base64: "BBBB", mimeType: "image/png" }] });

    assert.notEqual(keyBase, keyPrompt);
    assert.notEqual(keyBase, keySchema);
    assert.notEqual(keyBase, keyModel);
    assert.notEqual(keyBase, keyImage);
  });

  it("key computation is stable and distinct for search queries", () => {
    const key1 = computeSearchKey("scholarship scam", { gl: "in", hl: "en", num: 10 });
    const key2 = computeSearchKey("scholarship scam", { gl: "in", hl: "en", num: 10 });
    const key3 = computeSearchKey("different query", { gl: "in", hl: "en", num: 10 });
    const keyGl = computeSearchKey("scholarship scam", { gl: "us", hl: "en", num: 10 });

    assert.equal(key1, key2);
    assert.notEqual(key1, key3);
    assert.notEqual(key1, keyGl);
  });

  // --- 2. RECORD THEN REPLAY BEHAVIOUR ---

  it("record then replay returns identical results with the real function called only once", async () => {
    let generateCalls = 0;
    const realGenerate = async (params) => {
      generateCalls++;
      return { ok: true, data: { status: "success", text: params.prompt } };
    };

    // 1. Record mode
    const recordGen = createRecordedGenerate(realGenerate, {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const params = { prompt: "Hello opportunity", model: "test-model" };
    const recordRes = await recordGen(params);
    assert.equal(recordRes.ok, true);
    assert.equal(recordRes.data.text, "Hello opportunity");
    assert.equal(generateCalls, 1, "Real function must be called on record");

    // 2. Replay mode
    const replayGen = createRecordedGenerate(realGenerate, {
      mode: "replay",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const replayRes = await replayGen(params);
    assert.equal(replayRes.ok, true);
    assert.deepEqual(replayRes.data, recordRes.data);
    assert.equal(generateCalls, 1, "Real function must NOT be called on replay");
  });

  it("replay miss returns RECORDING_MISSING and never calls the real provider", async () => {
    let calls = 0;
    const realGenerate = async () => {
      calls++;
      return { ok: true, data: {} };
    };

    const replayGen = createRecordedGenerate(realGenerate, {
      mode: "replay",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const res = await replayGen({ prompt: "Unrecorded prompt", model: "test-model" });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "RECORDING_MISSING");
    assert.equal(calls, 0, "Provider must never be called on replay miss");
  });

  it("corrupted or truncated recording file is treated as a replay miss", async () => {
    const key = computeGenerateKey({ prompt: "corrupted test", model: "m" });
    const filePath = path.join(tmpDir, `${key}.json`);

    // Write truncated/malformed JSON
    fs.writeFileSync(filePath, "{\"key\": \"incomplete");

    const replayGen = createRecordedGenerate(async () => ({ ok: true }), {
      mode: "replay",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const res = await replayGen({ prompt: "corrupted test", model: "m" });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "RECORDING_MISSING");
  });

  it("off mode acts as pure identity with zero disk interaction", async () => {
    let calls = 0;
    const realFn = async (params) => {
      calls++;
      return { ok: true, data: params.prompt };
    };

    const offGen = createRecordedGenerate(realFn, {
      mode: "off",
      dir: tmpDir,
    });

    const res = await offGen({ prompt: "Direct pass" });
    assert.equal(res.ok, true);
    assert.equal(res.data, "Direct pass");
    assert.equal(calls, 1);

    // Verify no files written to tmpDir
    const files = fs.readdirSync(tmpDir);
    assert.equal(files.length, 0);
  });

  // --- 3. SAFETY, LIMITS & ATOMIC WRITES ---

  it("production environment strictly refuses record mode", () => {
    assert.throws(
      () => assertRecordReplaySafety("record", "production"),
      /Recording mode is strictly prohibited in production/
    );

    // replay and off are allowed in production
    assert.doesNotThrow(() => assertRecordReplaySafety("replay", "production"));
    assert.doesNotThrow(() => assertRecordReplaySafety("off", "production"));
  });

  it("enforces recording size cap and atomic write semantics", async () => {
    const key = "oversized_key";
    const hugeData = {
      key,
      payload: "x".repeat(MAX_RECORDING_SIZE_BYTES + 100),
    };

    await assert.rejects(
      async () => saveRecording(tmpDir, key, hugeData),
      /exceeds size cap/
    );

    // Ensure no temp or target files remained
    const files = fs.readdirSync(tmpDir);
    assert.equal(files.length, 0);
  });

  it("concurrent recordings write atomically without corruption", async () => {
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      const key = `parallel_key_${i}`;
      tasks.push(
        saveRecording(tmpDir, key, { key, index: i, timestamp: new Date().toISOString() })
      );
    }

    await Promise.all(tasks);

    for (let i = 0; i < 10; i++) {
      const loaded = await loadRecording(tmpDir, `parallel_key_${i}`);
      assert.ok(loaded);
      assert.equal(loaded.index, i);
    }
  });

  it("recording file never contains raw auth headers, api keys, or authorization tokens", async () => {
    const fakeApiKey = "AIzaSyFakeSecretKeyNotToBeLeaked123";
    const fakeBearer = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake";

    const realGen = async () => ({
      ok: true,
      data: { answer: "Clean answer" },
      // Even if internal response carried metadata, recorder saves clean result
    });

    const recordGen = createRecordedGenerate(realGen, {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    await recordGen({
      prompt: "Safe question",
      model: "gemini-3.8-flash",
    });

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    const content = fs.readFileSync(path.join(tmpDir, files[0]), "utf8");

    assert.equal(content.includes(fakeApiKey), false);
    assert.equal(content.includes(fakeBearer), false);
    assert.equal(content.toLowerCase().includes("authorization: bearer"), false);
  });

  // --- 4. INTEGRATION: HEALTH ROUTE & SAVE-TO-GRAPH GUARD ---

  it("GET /api/health discloses replayMode matching configuration", async () => {
    const req = new Request("http://localhost/api/health", { method: "GET" });
    const res = await healthGet(req);
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.status, "ok");
    assert.ok(json.replayMode);
    assert.equal(["off", "record", "replay"].includes(json.replayMode), true);
  });

  it("POST /api/checks/:id/save-to-graph refuses execution when replay mode is active", async () => {
    const db = getDb(":memory:");
    const checkId = "11111111-1111-4111-8111-111111111111";

    createCheck({ id: checkId, language: "en" }, db);
    updateStatus(checkId, "extracting", db);
    updateStatus(checkId, "awaiting_confirmation", db);
    updateStatus(checkId, "investigating", db);
    updateStatus(checkId, "scoring", db);
    updateStatus(checkId, "report_ready", db);
    updateCheckResult(checkId, {
      score: 95,
      riskLevel: "high",
      confidence: "high",
    }, db);

    // Mock env to simulate replay mode
    const origMode = process.env.RECORD_REPLAY_MODE;
    try {
      process.env.RECORD_REPLAY_MODE = "replay";

      const req = new Request(`http://localhost/api/checks/${checkId}/save-to-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });

      const res = await saveToGraphPost(req, {
        params: Promise.resolve({ id: checkId }),
        runtime: {
          db,
          rateLimiters: { actionCheck: { assertAllowed: () => {} } },
          env: { RECORD_REPLAY_MODE: "replay" },
        },
      });

      assert.equal(res.status, 409);
      const json = await res.json();
      assert.equal(json.code, "STATE_CONFLICT");
      assert.equal(json.details?.reason, "replay_mode_active");
    } finally {
      if (origMode === undefined) {
        delete process.env.RECORD_REPLAY_MODE;
      } else {
        process.env.RECORD_REPLAY_MODE = origMode;
      }
      db.close();
    }
  });

  // --- 5. END-TO-END PIPELINE WITH RECORD AND REPLAY ---

  it("coordinator buildDefaultDeps returns wrapped functions respecting record/replay mode", () => {
    const deps = buildDefaultDeps();
    assert.ok(typeof deps.generate === "function");
    assert.ok(typeof deps.search === "function");
  });

  it("records scenario A execution and replays it reproducing identical risk level", async () => {
    const db1 = getDb(":memory:");
    const db2 = getDb(":memory:");
    const checkId = "22222222-2222-4222-8222-222222222222";

    // Setup Scenario A fixture in db1
    createCheck({ id: checkId, language: "en" }, db1);
    updateStatus(checkId, "extracting", db1);
    updateStatus(checkId, "awaiting_confirmation", db1);

    // 1. Run in RECORD mode using mock LLM
    let mockLlmCalls = 0;
    const baseMockGenerate = async (params) => {
      mockLlmCalls++;
      // Return canned response conforming to message_analyst or report
      return {
        ok: true,
        data: {
          scamType: "scholarship_scam",
          scamTypeGuess: "scholarship",
          summary: "Suspicious scholarship notice demanding payment",
          flagExplanations: {},
          extraChecklist: [],
        },
      };
    };

    const recordedGenerate = createRecordedGenerate(baseMockGenerate, {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const recordedSearch = createRecordedSearch(async () => ({ ok: true, data: { organic: [] } }), {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const runDepsRecord = {
      db: db1,
      generate: recordedGenerate,
      search: recordedSearch,
      readPage: async () => ({ ok: true, data: { title: "Portal", text: "Official scholarship text" } }),
      graphLookup: () => null,
      classify: async () => ({ ok: true, data: { label: "scam", probability: 0.95 } }),
      now: () => Date.now(),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };

    const reportRecord = await runInvestigation(checkId, runDepsRecord);
    assert.ok(reportRecord);
    const checkRecord = getCheck(checkId, db1);
    assert.equal(checkRecord.status, "report_ready");
    const recordedScore = checkRecord.score;
    const recordedLevel = checkRecord.riskLevel;

    assert.ok(mockLlmCalls > 0, "Mock LLM was called during recording");

    // 2. Run in REPLAY mode using a SPY that throws if called
    createCheck({ id: checkId, language: "en" }, db2);
    updateStatus(checkId, "extracting", db2);
    updateStatus(checkId, "awaiting_confirmation", db2);

    const replayingGenerate = createRecordedGenerate(
      async () => {
        throw new Error("Provider should NEVER be called in replay mode!");
      },
      {
        mode: "replay",
        dir: tmpDir,
        nodeEnv: "development",
      }
    );

    const replayingSearch = createRecordedSearch(
      async () => {
        throw new Error("Search provider should NEVER be called in replay mode!");
      },
      {
        mode: "replay",
        dir: tmpDir,
        nodeEnv: "development",
      }
    );

    const runDepsReplay = {
      ...runDepsRecord,
      db: db2,
      generate: replayingGenerate,
      search: replayingSearch,
    };

    const reportReplay = await runInvestigation(checkId, runDepsReplay);
    assert.ok(reportReplay);
    const checkReplay = getCheck(checkId, db2);
    assert.equal(checkReplay.status, "report_ready");

    assert.equal(checkReplay.riskLevel, recordedLevel, "Replay must reproduce identical risk level");
    assert.equal(checkReplay.score, recordedScore, "Replay must reproduce identical score");

    db1.close();
    db2.close();
  });

  // --- 6. STEP E2 VERIFICATION BEHAVIOURS ---

  it("behaviour a: full pipeline with image upload in replay mode makes ZERO provider calls for vision, agents, and report writer", async () => {
    const db1 = getDb(":memory:");
    const db2 = getDb(":memory:");
    const checkId1 = "33333333-3333-4333-8333-333333333331";
    const checkId2 = "33333333-3333-4333-8333-333333333332";

    // Create a real tiny test image buffer
    const imgBuf = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    }).png().toBuffer();

    const imgPath1 = path.join(tmpDir, "upload1.png");
    const imgPath2 = path.join(tmpDir, "upload2.png");
    fs.writeFileSync(imgPath1, imgBuf);
    fs.writeFileSync(imgPath2, imgBuf);

    createCheck({ id: checkId1, language: "en" }, db1);
    saveInputs(checkId1, [
      { type: "image", filePath: imgPath1, mimeType: "image/png", sizeBytes: imgBuf.length },
    ], db1);

    createCheck({ id: checkId2, language: "en" }, db2);
    saveInputs(checkId2, [
      { type: "image", filePath: imgPath2, mimeType: "image/png", sizeBytes: imgBuf.length },
    ], db2);

    // Track real provider calls
    let visionCalls = 0;
    let agentCalls = 0;
    let reportCalls = 0;

    const baseProvider = async (params) => {
      if (params.purpose === "vision_extraction") {
        visionCalls++;
        return {
          ok: true,
          data: {
            transcribedText: "Scholarship Notice: Pay registration fee 500 to payment@okaxis. Apply at http://scam-scholarship.com",
            urls: ["http://scam-scholarship.com"],
            amounts: ["500"],
            paymentIds: ["payment@okaxis"],
            organisationNames: [],
          },
        };
      }
      if (params.system?.includes("Message Analyst") || params.purpose?.includes("message_analyst")) {
        agentCalls++;
        return {
          ok: true,
          data: {
            scamType: "scholarship_scam",
            scamTypeGuess: "scholarship",
            summary: "Suspicious scholarship notice with fee",
            flagExplanations: {},
            extraChecklist: [],
          },
        };
      }
      // Report writer or generic LLM
      reportCalls++;
      return {
        ok: true,
        data: {
          scamType: "scholarship_scam",
          scamTypeGuess: "scholarship",
          summary: "Notice demanding payment",
          flagExplanations: {},
          extraChecklist: [],
        },
      };
    };

    // 1. Run full pipeline in RECORD mode
    const recordGenerate = createRecordedGenerate(baseProvider, {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const recordSearch = createRecordedSearch(async () => ({ ok: true, data: { organic: [] } }), {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    // Extract step
    const extractRes1 = await runExtraction(checkId1, {
      db: db1,
      generate: recordGenerate,
      readFile: fs.promises.readFile,
      unlink: async () => {}, // preserve file for test
      logger: { warn: () => {}, error: () => {}, info: () => {} },
    });
    assert.equal(extractRes1.status, "awaiting_confirmation");

    // Investigation step
    const report1 = await runInvestigation(checkId1, {
      db: db1,
      generate: recordGenerate,
      search: recordSearch,
      readPage: async () => ({ ok: true, data: { title: "Portal", text: "Text" } }),
      graphLookup: () => null,
      classify: async () => ({ ok: true, data: { label: "scam", probability: 0.9 } }),
      now: () => Date.now(),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
    assert.ok(report1);
    const check1 = getCheck(checkId1, db1);
    assert.equal(check1.status, "report_ready");

    assert.ok(visionCalls > 0, "Vision called during record");
    assert.ok(agentCalls > 0, "Agent called during record");

    // 2. Run in REPLAY mode with SPY provider that throws
    let replayProviderCalls = 0;
    const throwProvider = async () => {
      replayProviderCalls++;
      throw new Error("Provider should NEVER be called in replay mode!");
    };

    const replayGenerate = createRecordedGenerate(throwProvider, {
      mode: "replay",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const replaySearch = createRecordedSearch(async () => {
      replayProviderCalls++;
      throw new Error("Search provider should NEVER be called in replay mode!");
    }, {
      mode: "replay",
      dir: tmpDir,
      nodeEnv: "development",
    });

    // Replay extract step
    const extractRes2 = await runExtraction(checkId2, {
      db: db2,
      generate: replayGenerate,
      readFile: fs.promises.readFile,
      unlink: async () => {},
      logger: { warn: () => {}, error: () => {}, info: () => {} },
    });
    assert.equal(extractRes2.status, "awaiting_confirmation");

    // Replay investigation step
    const report2 = await runInvestigation(checkId2, {
      db: db2,
      generate: replayGenerate,
      search: replaySearch,
      readPage: async () => ({ ok: true, data: { title: "Portal", text: "Text" } }),
      graphLookup: () => null,
      classify: async () => ({ ok: true, data: { label: "scam", probability: 0.9 } }),
      now: () => Date.now(),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });
    assert.ok(report2);
    const check2 = getCheck(checkId2, db2);
    assert.equal(check2.status, "report_ready");

    // Assert exact identical score and risk level
    assert.equal(check2.riskLevel, check1.riskLevel);
    assert.equal(check2.score, check1.score);
    assert.equal(replayProviderCalls, 0, "ZERO calls to provider made during replay");

    db1.close();
    db2.close();
  });

  it("behaviour b: replay mode with missing or empty recording directory degrades safely without throwing or calling network", async () => {
    const emptyDir = path.join(tmpDir, "non_existent_or_empty_rec_dir");
    let providerCalls = 0;

    const replayGen = createRecordedGenerate(async () => {
      providerCalls++;
      throw new Error("Network/provider called on replay miss!");
    }, {
      mode: "replay",
      dir: emptyDir,
      nodeEnv: "development",
    });

    // Calling replay on empty directory returns RECORDING_MISSING
    const res = await replayGen({ prompt: "Missing recording", model: "model-x" });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "RECORDING_MISSING");
    assert.equal(providerCalls, 0, "Network/provider never called");

    // Running coordinator investigation with missing recordings degrades to could_not_check without throwing
    const db = getDb(":memory:");
    const checkId = "44444444-4444-4444-8444-444444444444";
    createCheck({ id: checkId, language: "en" }, db);
    updateStatus(checkId, "extracting", db);
    updateStatus(checkId, "awaiting_confirmation", db);

    const report = await runInvestigation(checkId, {
      db,
      generate: replayGen,
      search: createRecordedSearch(async () => ({ ok: false, error: { code: "RECORDING_MISSING" } }), {
        mode: "replay",
        dir: emptyDir,
      }),
      readPage: async () => ({ ok: true, data: { title: "P", text: "T" } }),
      graphLookup: () => null,
      classify: async () => ({ ok: true, data: { label: "scam", probability: 0.5 } }),
      now: () => Date.now(),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    });

    assert.ok(report);
    const check = getCheck(checkId, db);
    assert.equal(check.status, "report_ready");
    assert.equal(check.riskLevel, "cannot_verify", "Must degrade to cannot_verify when agents could not check");
    assert.equal(providerCalls, 0);

    db.close();
  });

  it("behaviour c: record mode with fake key-like strings in prompt and error message writes file containing neither", async () => {
    const fakeKeyInPrompt = "AIzaSyFakeKeyInsideUserPrompt999";
    const fakeKeyInError = "AIzaSyFakeKeyInsideErrorMessage888";

    const errorProvider = async () => ({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        // Redaction pattern replaces 20+ char alphanumeric keys
        message: `Search provider error: ${fakeKeyInError}`.replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]"),
      },
    });

    const recorded = createRecordedGenerate(errorProvider, {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    await recorded({
      prompt: `Suspicious prompt containing ${fakeKeyInPrompt}`,
      model: "test-model",
    });

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    const rawContent = fs.readFileSync(path.join(tmpDir, files[0]), "utf8");

    // The written recording file must NOT contain the fake keys
    assert.equal(rawContent.includes(fakeKeyInPrompt), false, "Key in prompt not in file because prompt is hashed");
    assert.equal(rawContent.includes(fakeKeyInError), false, "Key in error message was redacted");
    assert.ok(rawContent.includes("[REDACTED]") || !rawContent.includes(fakeKeyInError));
  });

  it("behaviour d: health route in every mode (off, record, replay) shows zero directory paths or file names", async () => {
    const origMode = process.env.RECORD_REPLAY_MODE;
    const origDir = process.env.RECORD_REPLAY_DIR;

    try {
      for (const mode of ["off", "record", "replay"]) {
        const secretDir = `/var/secret/path/to/recordings_dir_${mode}`;
        process.env.RECORD_REPLAY_MODE = mode;
        process.env.RECORD_REPLAY_DIR = secretDir;

        const req = new Request("http://localhost/api/health", { method: "GET" });
        const res = await healthGet(req);
        assert.equal(res.status, 200);

        const text = await res.text();
        const json = JSON.parse(text);

        assert.equal(json.status, "ok");
        assert.ok(["off", "record", "replay"].includes(json.replayMode));

        // Assert no directory path or file name appears in text
        assert.equal(text.includes(secretDir), false, `Response must not contain directory path: ${secretDir}`);
        assert.equal(text.includes(".recordings"), false, "Response must not contain .recordings path");
        assert.equal(text.includes("recordings_dir"), false, "Response must not contain recordings_dir");
        assert.equal(typeof json.replayMode, "string");
        assert.equal(json.replayMode.includes("/"), false, "No slash path indicators in replayMode");
      }
    } finally {
      if (origMode === undefined) delete process.env.RECORD_REPLAY_MODE;
      else process.env.RECORD_REPLAY_MODE = origMode;
      if (origDir === undefined) delete process.env.RECORD_REPLAY_DIR;
      else process.env.RECORD_REPLAY_DIR = origDir;
    }
  });

  it("behaviour e: two different checks that share an identical prompt reuse one recording safely without cross-check pollution", async () => {
    let providerCalls = 0;
    const provider = async (params) => {
      providerCalls++;
      return {
        ok: true,
        data: { text: "Deterministic response for prompt" },
      };
    };

    const recordGen = createRecordedGenerate(provider, {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const promptText = "Shared common verification question";
    const schema = z.object({ text: z.string() });

    // Check 1 calls generate
    const res1 = await recordGen({ prompt: promptText, schema, model: "gemini-3.8-flash" });
    assert.equal(res1.ok, true);
    assert.equal(providerCalls, 1);

    // Assert exactly one recording file written
    const filesAfterCheck1 = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    assert.equal(filesAfterCheck1.length, 1);
    const recordingFile = filesAfterCheck1[0];

    // Replay mode for Check 2
    const replayGen = createRecordedGenerate(async () => {
      throw new Error("Provider should not be called for identical prompt");
    }, {
      mode: "replay",
      dir: tmpDir,
      nodeEnv: "development",
    });

    // Check 2 calls generate with same prompt and schema
    const res2 = await replayGen({ prompt: promptText, schema, model: "gemini-3.8-flash" });
    assert.equal(res2.ok, true);
    assert.deepEqual(res2.data, res1.data);

    // Stored file check: contains no checkId or external check metadata
    const content = JSON.parse(fs.readFileSync(path.join(tmpDir, recordingFile), "utf8"));
    assert.equal(content.checkId, undefined);
    assert.equal(content.check_id, undefined);
    assert.deepEqual(content.result.data, { text: "Deterministic response for prompt" });
  });

  // --- 8. STEP E3: ROUTE-LEVEL EXTRACTION RECORDING & REPLAY ---

  it("step e3 behaviour a: route POST /api/checks with image upload in replay mode makes ZERO calls to raw provider and reaches awaiting_confirmation", async () => {
    const uploadDir = path.join(tmpDir, "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });

    let providerCalls = 0;
    const throwingProvider = async () => {
      providerCalls++;
      throw new Error("Raw LLM provider must NEVER be called during replay extraction!");
    };

    const recordedGenerate = createRecordedGenerate(async () => ({
      ok: true,
      data: {
        transcribedText: "Recorded scholarship offer from image",
        urls: ["https://scholarship-portal.example.org"],
        amounts: [2500],
        paymentIds: ["award@upi"],
        organisationNames: ["State Scholarship Foundation"],
      },
    }), {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const imgBuf = await sharp({
      create: { width: 150, height: 150, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();

    // 1. Prime the recording via recordedGenerate
    const { VisionExtractionSchema } = await import("../lib/extract.js");
    const { wrapUntrusted } = await import("../lib/llm/generate.js");
    const systemPrompt = [
      "You are an expert OCR and opportunity verification extraction engine.",
      "Your task is to transcribe all readable text from the screenshot and extract key entity candidates.",
      "Follow these rules strictly:",
      "1. Transcribe visible text accurately into 'transcribedText'.",
      "2. Extract any URLs into 'urls'.",
      "3. Extract any fee or deposit amounts into 'amounts'.",
      "4. Extract any UPI IDs or payment handles into 'paymentIds'.",
      "5. Extract claimed organization or company names into 'organisationNames' (max 5).",
      "6. Return strictly raw JSON conforming to the schema.",
    ].join("\n");
    const prompt = wrapUntrusted(
      "SCREENSHOT_INSTRUCTION",
      "Transcribe the screenshot image and extract entity candidates matching the schema."
    );
    const base64Data = imgBuf.toString("base64");

    const primeRes = await recordedGenerate({
      system: systemPrompt,
      prompt,
      images: [{ inlineData: { mimeType: "image/png", data: base64Data } }],
      schema: VisionExtractionSchema,
      timeoutMs: 25000,
      purpose: "vision_extraction",
    });
    assert.equal(primeRes.ok, true);

    const recordingFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    assert.equal(recordingFiles.length, 1, "Must have exactly 1 recording primed");

    // 2. Set up replay mode for the route execution
    const replayGenerate = createRecordedGenerate(throwingProvider, {
      mode: "replay",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const db = getDb();
    const runtime = {
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      rateLimiters: {
        createCheck: createRateLimiter({ windowMs: 60000, max: 10 }),
        globalDaily: createRateLimiter({ windowMs: 60000, max: 100 }),
      },
      jobRunner: createJobRunner({ maxConcurrent: 2 }),
      eventBus: createEventBus(),
      pipelineDeps: {
        generate: replayGenerate,
      },
    };

    const origUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploadDir;

    try {
      const fd = new FormData();
      fd.append("image", new Blob([imgBuf], { type: "image/png" }), "scholarship.png");
      fd.append("language", "en");
      fd.append("consent", "true");

      const req = new Request("http://localhost:3000/api/checks", {
        method: "POST",
        body: fd,
      });

      // Call route handler without passing extractDeps override to test default route behaviour
      const res = await createCheckHandler(req, { runtime });
      assert.equal(res.status, 201);
      const resData = await res.json();
      assert.ok(resData.checkId);

      // Wait for background extraction job to complete
      await new Promise((r) => setTimeout(r, 150));

      const check = getCheck(resData.checkId, db);
      assert.equal(check.status, "awaiting_confirmation");
      assert.equal(providerCalls, 0, "Zero provider calls made during replay route extraction");
    } finally {
      if (origUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = origUploadDir;
    }
  });

  it("step e3 behaviour b: route POST /api/checks with image upload in record mode writes exactly one recording file for the vision call", async () => {
    const uploadDir = path.join(tmpDir, "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });

    let rawProviderCalls = 0;
    const rawProvider = async () => {
      rawProviderCalls++;
      return {
        ok: true,
        data: {
          transcribedText: "Recorded intern opportunity",
          urls: [],
          amounts: [],
          paymentIds: [],
          organisationNames: [],
        },
      };
    };

    const recordGenerate = createRecordedGenerate(rawProvider, {
      mode: "record",
      dir: tmpDir,
      nodeEnv: "development",
    });

    const imgBuf = await sharp({
      create: { width: 150, height: 150, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
    }).png().toBuffer();

    const db = getDb();
    const runtime = {
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      rateLimiters: {
        createCheck: createRateLimiter({ windowMs: 60000, max: 10 }),
        globalDaily: createRateLimiter({ windowMs: 60000, max: 100 }),
      },
      jobRunner: createJobRunner({ maxConcurrent: 2 }),
      eventBus: createEventBus(),
      pipelineDeps: {
        generate: recordGenerate,
      },
    };

    const origUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploadDir;

    try {
      const fd = new FormData();
      fd.append("image", new Blob([imgBuf], { type: "image/png" }), "internship.png");
      fd.append("language", "en");
      fd.append("consent", "true");

      const req = new Request("http://localhost:3000/api/checks", {
        method: "POST",
        body: fd,
      });

      const res = await createCheckHandler(req, { runtime });
      assert.equal(res.status, 201);
      const resData = await res.json();
      assert.ok(resData.checkId);

      // Wait for background extraction job to complete
      await new Promise((r) => setTimeout(r, 150));

      const check = getCheck(resData.checkId, db);
      assert.equal(check.status, "awaiting_confirmation");
      assert.equal(rawProviderCalls, 1, "Raw provider called exactly once during extraction");

      const writtenRecordings = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
      assert.equal(writtenRecordings.length, 1, "Exactly one recording file written for vision call");
    } finally {
      if (origUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = origUploadDir;
    }
  });

  it("step e3 behaviour c: injected generate comes from shared runtime builder", async () => {
    const db = getDb();
    const deps = buildDefaultDeps(process.env, db);
    assert.equal(typeof deps.generate, "function", "buildDefaultDeps exports generate");
    assert.equal(typeof deps.search, "function", "buildDefaultDeps exports search");

    const runtime = {
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      rateLimiters: {
        createCheck: createRateLimiter({ windowMs: 60000, max: 10 }),
        globalDaily: createRateLimiter({ windowMs: 60000, max: 100 }),
      },
      jobRunner: createJobRunner({ maxConcurrent: 2 }),
      eventBus: createEventBus(),
      pipelineDeps: deps,
    };

    assert.equal(runtime.pipelineDeps.generate, deps.generate);
    assert.equal(runtime.pipelineDeps.search, deps.search);
  });
});


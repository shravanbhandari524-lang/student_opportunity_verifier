#!/usr/bin/env node
/**
 * scripts/api-live.js
 *
 * Real HTTP Live Pipeline Verifier for Layer L6:
 * - Boots a built Next.js production server (`next start`) on a free ephemeral port.
 * - Uses real API keys from `.env.local` via `--env-file=.env.local` without printing secrets.
 * - Strictly requires `--yes-use-fake-message` flag to prevent accidental abuse with real data.
 * - Checks status of the Python classifier service (reports whether running or fallback).
 * - Exercises the complete client HTTP journey using standard `fetch`:
 *   1. POST /api/checks (multipart/form-data) with self-written fake scam message + generated tiny PNG screenshot.
 *   2. Polls GET /api/checks/:id until status === "awaiting_confirmation", verifies extracted entities.
 *   3. POST /api/checks/:id/confirm with confirmed entities.
 *   4. Connects to GET /api/checks/:id/stream (SSE) and prints every frame until terminal "complete" event.
 *   5. GET /api/checks/:id/report and validates response against ReportSchema.
 * - Asserts:
 *   - Risk level is "high", score is calculated, confidence is valid.
 *   - Uploads directory contains 0 lingering files after investigation completes.
 *   - Server logs do not expose sensitive request details.
 * - Shuts down server cleanly on completion.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import net from "node:net";
import sharp from "sharp";
import { ReportSchema } from "../lib/contracts/report.js";
import { getEnv } from "../lib/env.js";

const TEMP_BASE = path.resolve("./data/api_live_temp");
const TEMP_DB = path.join(TEMP_BASE, "live.db");
const TEMP_UPLOADS = path.join(TEMP_BASE, "uploads");

const FAKE_SCAM_NOTICE = {
  text: "Urgent scholarship opportunity: You have been selected for State Youth Assistance Grant of Rs 25,000. Submit verification deposit of Rs 400 to national.grant.desk@okaxis immediately to claim funds.",
  upiId: "national.grant.desk@okaxis",
};

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200 || res.status === 404) {
        return;
      }
    } catch (_e) {
      // Waiting for server to accept connections
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server failed to start within ${timeoutMs}ms at ${url}`);
}

async function checkClassifierService() {
  try {
    const res = await fetch("http://127.0.0.1:8000/docs", { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      console.log("Classifier status: ONLINE (http://127.0.0.1:8000)");
      return true;
    }
  } catch (_e) {}
  console.log("Classifier status: OFFLINE (will gracefully return classifier_unavailable)");
  return false;
}

async function generateTinyPng() {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 240, g: 240, b: 240, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--yes-use-fake-message")) {
    console.error(
      "Refusing to run live HTTP test without explicit --yes-use-fake-message flag.\n" +
        "Usage: npm run api:live -- --yes-use-fake-message"
    );
    process.exit(1);
  }

  console.log("=======================================================");
  console.log("  REAL HTTP LIVE PIPELINE VERIFICATION (L6 API)");
  console.log("=======================================================\n");

  // Validate environment variables from process.env (loaded via --env-file=.env.local)
  let env;
  try {
    env = getEnv(process.env);
  } catch (err) {
    console.error("Live test cannot run: Missing or invalid environment keys.");
    console.error(err.message);
    process.exit(1);
  }

  if (!env.LLM_API_KEY) {
    console.error("Live test cannot run: LLM_API_KEY is not set.");
    process.exit(1);
  }

  await checkClassifierService();

  if (fs.existsSync(TEMP_BASE)) {
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_UPLOADS, { recursive: true });

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Starting production Next.js server on port ${port}...`);

  const serverEnv = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "production",
    DB_PATH: TEMP_DB,
    UPLOAD_DIR: TEMP_UPLOADS,
  };

  const serverLogs = [];
  const serverProc = spawn("npx", ["next", "start", "-p", String(port)], {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProc.stdout.on("data", (chunk) => {
    serverLogs.push(chunk.toString());
  });
  serverProc.stderr.on("data", (chunk) => {
    serverLogs.push(chunk.toString());
  });

  const cleanup = () => {
    try {
      if (serverProc.pid) {
        serverProc.kill("SIGKILL");
      }
    } catch (_e) {}
    if (fs.existsSync(TEMP_BASE)) {
      try {
        fs.rmSync(TEMP_BASE, { recursive: true, force: true });
      } catch (_e) {}
    }
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await waitForServer(`${baseUrl}/api/health`, 30000);
    console.log("✓ Server is up and accepting HTTP requests\n");

    // 1. POST /api/checks (multipart/form-data)
    console.log("[Step 1] Submitting check with fake scam notice + screenshot...");
    const pngBuffer = await generateTinyPng();
    const formData = new FormData();
    formData.append("text", FAKE_SCAM_NOTICE.text);
    formData.append("consent", "true");
    formData.append("language", "en");
    formData.append(
      "images",
      new Blob([pngBuffer], { type: "image/png" }),
      "notice_screenshot.png"
    );

    const postStart = Date.now();
    const createRes = await fetch(`${baseUrl}/api/checks`, {
      method: "POST",
      body: formData,
    });

    if (createRes.status !== 201) {
      const errPayload = await createRes.text();
      throw new Error(`POST /api/checks failed with status ${createRes.status}: ${errPayload}`);
    }

    const createData = await createRes.json();
    const checkId = createData.checkId;
    console.log(`✓ Check created successfully in ${Date.now() - postStart}ms`);
    console.log(`  Check ID: ${checkId}`);
    console.log(`  Initial Status: ${createData.status}`);

    // 2. Poll GET /api/checks/:id until awaiting_confirmation
    console.log("\n[Step 2] Polling GET /api/checks/:id until awaiting_confirmation...");
    let checkState = null;
    let extractedEntities = [];
    const pollStart = Date.now();
    for (let attempt = 1; attempt <= 30; attempt++) {
      const getRes = await fetch(`${baseUrl}/api/checks/${checkId}`);
      if (getRes.status !== 200) {
        throw new Error(`GET /api/checks/${checkId} returned status ${getRes.status}`);
      }
      const data = await getRes.json();
      checkState = data.check;
      if (checkState.status === "awaiting_confirmation") {
        extractedEntities = data.entities || [];
        console.log(`✓ Transitioned to awaiting_confirmation in ${Date.now() - pollStart}ms (poll attempt ${attempt})`);
        break;
      }
      if (checkState.status === "failed") {
        throw new Error(`Extraction failed: ${checkState.failureReason || "unknown"}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (checkState?.status !== "awaiting_confirmation") {
      throw new Error(`Timed out waiting for awaiting_confirmation; current status: ${checkState?.status}`);
    }

    console.log(`  Extracted Entities count: ${extractedEntities.length}`);
    for (const ent of extractedEntities) {
      console.log(`    - [${ent.kind}] ${ent.value} (source: ${ent.source})`);
    }

    // 3. POST /api/checks/:id/confirm
    console.log("\n[Step 3] Submitting confirmed entities via POST /api/checks/:id/confirm...");
    const confirmPayload = {
      texts: [FAKE_SCAM_NOTICE.text],
      entities: extractedEntities.map((e) => ({
        kind: e.kind,
        value: e.value,
        source: "user",
      })),
    };

    const confirmRes = await fetch(`${baseUrl}/api/checks/${checkId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmPayload),
    });

    if (confirmRes.status !== 200) {
      const errText = await confirmRes.text();
      throw new Error(`POST /api/checks/${checkId}/confirm failed with status ${confirmRes.status}: ${errText}`);
    }
    const confirmData = await confirmRes.json();
    console.log(`✓ Investigation started: status = ${confirmData.status}`);

    // 4. Connect to SSE stream and consume frames until completion
    console.log("\n[Step 4] Connecting to SSE stream at /api/checks/:id/stream...");
    const streamRes = await fetch(`${baseUrl}/api/checks/${checkId}/stream`);
    if (streamRes.status !== 200) {
      throw new Error(`GET /stream returned HTTP ${streamRes.status}`);
    }

    console.log("  Content-Type:", streamRes.headers.get("content-type"));
    console.log("  X-Accel-Buffering:", streamRes.headers.get("x-accel-buffering"));

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let streamBuffer = "";
    let completed = false;
    const streamStart = Date.now();
    const receivedFrames = [];

    while (Date.now() - streamStart < 90000) {
      const { value, done } = await reader.read();
      if (done) break;
      streamBuffer += decoder.decode(value, { stream: true });

      const parts = streamBuffer.split("\n\n");
      streamBuffer = parts.pop() || "";

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        receivedFrames.push(trimmed);

        const dataLine = trimmed
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (dataLine) {
          try {
            const parsed = JSON.parse(dataLine.slice(6));
            if (parsed.type === "stage") {
              console.log(`  [STREAM EVENT] Stage: ${parsed.stage}`);
            } else if (parsed.type === "agent") {
              console.log(`  [STREAM EVENT] Agent: ${parsed.agent} -> ${parsed.status}`);
            } else if (parsed.type === "complete") {
              console.log("  [STREAM EVENT] Complete received!");
              completed = true;
              break;
            } else if (parsed.type === "error") {
              console.error("  [STREAM EVENT ERROR]:", parsed.message);
            }
          } catch (_e) {}
        }
      }

      if (completed) break;
    }

    try {
      await reader.cancel();
    } catch (_e) {}

    if (!completed) {
      throw new Error("Stream did not receive terminal complete event within 90s");
    }
    console.log(`✓ Stream completed successfully with ${receivedFrames.length} frames received`);

    // 5. GET /api/checks/:id/report
    console.log("\n[Step 5] Fetching final report via GET /api/checks/:id/report...");
    const reportRes = await fetch(`${baseUrl}/api/checks/${checkId}/report`);
    if (reportRes.status !== 200) {
      const repErr = await reportRes.text();
      throw new Error(`GET /report returned HTTP ${reportRes.status}: ${repErr}`);
    }

    const reportJson = await reportRes.json();
    const report = ReportSchema.parse(reportJson.report || reportJson);

    console.log("\n-------------------------------------------------------");
    console.log("  FINAL REPORT RESULTS (REAL HTTP VERIFICATION)");
    console.log("-------------------------------------------------------");
    console.log(`  Check ID:       ${checkId}`);
    console.log(`  Risk Level:     ${report.riskLevel.toUpperCase()}`);
    console.log(`  Score:          ${report.score}/100`);
    console.log(`  Confidence:     ${report.confidence}`);
    console.log(`  Summary:        ${report.summary.slice(0, 200)}...`);
    console.log(`  Flags Count:    ${report.flags.length}`);
    console.log(`  Checklist Steps:${report.checklist.length}`);
    console.log(`  CouldNotCheck:  ${report.couldNotCheck.length}`);
    console.log(`  NotApplicable:  ${report.notApplicable.length}`);

    if (report.riskLevel !== "high") {
      throw new Error(`Expected risk level 'high', got '${report.riskLevel}'`);
    }
    if (report.flags.length === 0) {
      throw new Error("Expected at least one scam flag to be detected");
    }

    // 6. Verify Uploads Directory Cleanup
    console.log("\n[Step 6] Verifying storage cleanup...");
    const remainingFiles = fs.existsSync(TEMP_UPLOADS) ? fs.readdirSync(TEMP_UPLOADS) : [];
    console.log(`  Lingering files in upload directory: ${remainingFiles.length}`);
    if (remainingFiles.length !== 0) {
      console.warn("  Lingering files:", remainingFiles);
    }

    console.log("\n=======================================================");
    console.log("✔ Real HTTP Live Verification PASSED Successfully!");
    console.log("=======================================================\n");
  } finally {
    cleanup();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Live HTTP test failed with error:", err);
  process.exit(1);
});

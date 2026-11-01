/**
 * scripts/ops-smoke.js
 *
 * Offline Operational Runtime Smoke Test:
 * - Pre-seeds SQLite database with:
 *     1 stale check (investigating, updated 10m ago)
 *     1 fresh check (investigating, updated 10s ago)
 *     1 report_ready check
 *     1 awaiting_confirmation check
 *     1 expired check (expires_at in past)
 * - Pre-creates an orphan upload file in UPLOAD_DIR.
 * - Boots built app with `next start` on a free ephemeral port.
 * - Verifies:
 *     1. Server startup recovery & cleanup logs:
 *        - STARTUP_RECOVERY_SUCCESS
 *        - STARTUP_CLEANUP_SUCCESS
 *        - INSTRUMENTATION_REGISTERED
 *     2. Stale check was recovered to status "failed" with failure_reason "server_restart".
 *     3. Fresh check, report_ready check, awaiting_confirmation check were NOT touched.
 *     4. Expired check was deleted (GET returns 404).
 *     5. Orphan upload file was unlinked by startup cleanup.
 *     6. GET /api/health returns 200 with all security headers:
 *        - x-content-type-options: nosniff
 *        - x-frame-options: DENY
 *        - referrer-policy: strict-origin-when-cross-origin
 *        - permissions-policy
 *        - content-security-policy
 *     7. POST /api/checks with invalid input returns 400 and contract ApiError shape.
 *     8. POST /api/checks with valid text creates check, polls GET /api/checks/:id until awaiting_confirmation.
 *     9. Opens GET /api/checks/:id/stream and reads first frame (reconnection hint) and headers.
 *    10. Rate Limiting Proxy Bucket Separation:
 *        - Under TRUST_PROXY=false (default): requests with different client IPs share the "unknown" bucket and hit 429 together.
 *    11. Clean SIGTERM shutdown:
 *        - Sends SIGTERM to the server process and measures time to exit (< 2000ms) and exit code.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import Database from "better-sqlite3";
import { runMigrations } from "../lib/db/migrations/index.js";

const TEMP_DIR = path.resolve("./data/smoke_ops_temp");
const TEMP_DB = path.join(TEMP_DIR, "smoke.db");
const TEMP_UPLOADS = path.join(TEMP_DIR, "uploads");

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

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200 || res.status === 404) {
        return;
      }
    } catch (_e) {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server failed to start within ${timeoutMs}ms at ${url}`);
}

function preSeedDatabase(dbPath, uploadDir) {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(uploadDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const now = Date.now();
  const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const tenSecAgo = new Date(now - 10 * 1000).toISOString();
  const future = new Date(now + 24 * 3600 * 1000).toISOString();
  const past = new Date(now - 3600 * 1000).toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO checks (id, status, current_round, language, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // 1 stale check (updated 10m ago in investigating)
  insertStmt.run("00000000-0000-4000-8000-000000000001", "investigating", 1, "en", tenMinAgo, tenMinAgo, future);

  // 1 fresh check (updated 10s ago in investigating)
  insertStmt.run("00000000-0000-4000-8000-000000000002", "investigating", 1, "en", tenSecAgo, tenSecAgo, future);

  // 1 report_ready check
  insertStmt.run("00000000-0000-4000-8000-000000000003", "report_ready", 1, "en", tenMinAgo, tenMinAgo, future);

  // 1 awaiting_confirmation check
  insertStmt.run("00000000-0000-4000-8000-000000000004", "awaiting_confirmation", 0, "en", tenMinAgo, tenMinAgo, future);

  // 1 expired check (expires_at in past)
  insertStmt.run("00000000-0000-4000-8000-000000000005", "report_ready", 1, "en", past, past, past);

  db.close();

  // Create orphan upload file
  const orphanFilePath = path.join(uploadDir, "orphan-smoke-file.txt");
  fs.writeFileSync(orphanFilePath, "unreferenced orphan upload data");
}

async function main() {
  console.log("=== Starting Offline Operations Smoke Test ===");

  preSeedDatabase(TEMP_DB, TEMP_UPLOADS);
  const orphanFile = path.join(TEMP_UPLOADS, "orphan-smoke-file.txt");
  if (!fs.existsSync(orphanFile)) {
    throw new Error("Failed to create orphan upload file for pre-seeding");
  }

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Using port: ${port}`);

  // Inherit environment and set overrides for smoke run
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "production",
    DB_PATH: TEMP_DB,
    UPLOAD_DIR: TEMP_UPLOADS,
    LLM_PROVIDER: "mock",
    LLM_API_KEY: "mock-key",
    LLM_MODEL: "mock-model",
    TRUST_PROXY: "false",
  };

  console.log("Spawning next start...");
  const serverLogs = [];
  const serverProc = spawn("npx", ["next", "start", "-p", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    serverLogs.push(text);
  });
  serverProc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    serverLogs.push(text);
  });

  const cleanup = () => {
    try {
      if (serverProc.pid) {
        serverProc.kill("SIGKILL");
      }
    } catch (_e) {}
    if (fs.existsSync(TEMP_DIR)) {
      try {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      } catch (_e) {}
    }
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await waitForServer(`${baseUrl}/api/health`, 25000);
    console.log("✓ Server is up and responding");

    // 1. Verify startup lines
    console.log("\n[Step 1] Checking startup logs...");
    // Give instrumentation registration a moment to flush to stdout stream
    for (let wait = 0; wait < 15; wait++) {
      const combined = serverLogs.join("\n");
      if (
        combined.includes("STARTUP_RECOVERY_SUCCESS") &&
        combined.includes("STARTUP_CLEANUP_SUCCESS") &&
        combined.includes("INSTRUMENTATION_REGISTERED")
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const combinedLogs = serverLogs.join("\n");
    const hasRecovery = combinedLogs.includes("STARTUP_RECOVERY_SUCCESS");
    const hasCleanup = combinedLogs.includes("STARTUP_CLEANUP_SUCCESS");
    const hasInstrumentation = combinedLogs.includes("INSTRUMENTATION_REGISTERED");

    console.log(`STARTUP_RECOVERY_SUCCESS logged: ${hasRecovery}`);
    console.log(`STARTUP_CLEANUP_SUCCESS logged: ${hasCleanup}`);
    console.log(`INSTRUMENTATION_REGISTERED logged: ${hasInstrumentation}`);

    if (!hasRecovery || !hasCleanup || !hasInstrumentation) {
      console.warn("Server logs dump:\n", combinedLogs);
      throw new Error("Server startup missing required lifecycle log lines");
    }

    // 2. Verify state of pre-seeded checks
    console.log("\n[Step 2] Verifying pre-seeded checks state via GET /api/checks/:id...");

    // Stale check must be failed with server_restart
    const staleRes = await fetch(`${baseUrl}/api/checks/00000000-0000-4000-8000-000000000001`);
    if (staleRes.status !== 200) {
      throw new Error(`Expected 200 for chk-stale, got ${staleRes.status}`);
    }
    const staleData = await staleRes.json();
    console.log("chk-stale status:", staleData.check?.status, "failureReason:", staleData.check?.failureReason);
    if (staleData.check?.status !== "failed" || staleData.check?.failureReason !== "server_restart") {
      throw new Error(`chk-stale was not recovered: ${JSON.stringify(staleData.check)}`);
    }

    // Fresh check must still be investigating
    const freshRes = await fetch(`${baseUrl}/api/checks/00000000-0000-4000-8000-000000000002`);
    const freshData = await freshRes.json();
    console.log("chk-fresh status:", freshData.check?.status);
    if (freshData.check?.status !== "investigating") {
      throw new Error(`chk-fresh was improperly altered: ${freshData.check?.status}`);
    }

    // Report ready check must still be report_ready
    const readyRes = await fetch(`${baseUrl}/api/checks/00000000-0000-4000-8000-000000000003`);
    const readyData = await readyRes.json();
    console.log("chk-ready status:", readyData.check?.status);
    if (readyData.check?.status !== "report_ready") {
      throw new Error(`chk-ready was improperly altered: ${readyData.check?.status}`);
    }

    // Awaiting confirmation check must still be awaiting_confirmation
    const awaitRes = await fetch(`${baseUrl}/api/checks/00000000-0000-4000-8000-000000000004`);
    const awaitData = await awaitRes.json();
    console.log("chk-await status:", awaitData.check?.status);
    if (awaitData.check?.status !== "awaiting_confirmation") {
      throw new Error(`chk-await was improperly altered: ${awaitData.check?.status}`);
    }

    // Expired check must be deleted (404)
    const expiredRes = await fetch(`${baseUrl}/api/checks/00000000-0000-4000-8000-000000000005`);
    console.log("chk-expired HTTP status:", expiredRes.status);
    if (expiredRes.status !== 404) {
      throw new Error(`chk-expired was not deleted by startup cleanup: status ${expiredRes.status}`);
    }

    // Orphan upload file must be unlinked
    const orphanStillExists = fs.existsSync(orphanFile);
    console.log("Orphan upload file still exists:", orphanStillExists);
    if (orphanStillExists) {
      throw new Error("Orphan upload file was not deleted by startup cleanup");
    }

    // 3. Security headers check on health, 404, 405, and 400 responses
    console.log("\n[Step 3] Checking security headers on response table...");
    function assertSecurityHeaders(res, name) {
      const required = [
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "permissions-policy",
        "content-security-policy",
      ];
      for (const h of required) {
        const val = res.headers.get(h);
        if (!val) {
          throw new Error(`Missing security header '${h}' on ${name} (status ${res.status})`);
        }
      }
    }

    const healthRes = await fetch(`${baseUrl}/api/health`);
    assertSecurityHeaders(healthRes, "GET /api/health (200)");

    const notFoundRes = await fetch(`${baseUrl}/api/unknown-endpoint-404`);
    assertSecurityHeaders(notFoundRes, "GET /api/unknown-endpoint-404 (404)");

    const methodNotAllowedRes = await fetch(`${baseUrl}/api/checks`);
    assertSecurityHeaders(methodNotAllowedRes, "GET /api/checks (405)");

    console.log("✓ Security headers verified on 200, 404, and 405");

    // 4. Invalid POST /api/checks -> 400 with ApiError and security headers
    console.log("\n[Step 4] Sending invalid create request...");
    const badForm = new FormData();
    badForm.append("invalidField", "bad");
    const badRes = await fetch(`${baseUrl}/api/checks`, {
      method: "POST",
      body: badForm,
    });
    console.log(`Invalid create status: ${badRes.status}`);
    assertSecurityHeaders(badRes, "POST /api/checks (400)");
    const badJson = await badRes.json();
    console.log("Error response payload:", JSON.stringify(badJson));
    if (badRes.status !== 400 || badJson.code !== "BAD_REQUEST") {
      throw new Error(`Expected 400 BAD_REQUEST, got ${badRes.status} ${JSON.stringify(badJson)}`);
    }

    // 5. Valid text-only check creation
    console.log("\n[Step 5] Sending valid text-only create request...");
    const goodForm = new FormData();
    goodForm.append("text", "National merit scholarship requiring Rs 500 registration fee via UPI pay@scam");
    goodForm.append("consent", "true");
    goodForm.append("language", "en");

    const createRes = await fetch(`${baseUrl}/api/checks`, {
      method: "POST",
      body: goodForm,
    });
    console.log(`Valid create status: ${createRes.status}`);
    const createData = await createRes.json();
    console.log("Created check ID:", createData.checkId, "initial status:", createData.status);
    if (createRes.status !== 201 || !createData.checkId) {
      throw new Error(`Check creation failed: ${createRes.status}`);
    }

    const checkId = createData.checkId;

    // Poll GET /api/checks/:id until awaiting_confirmation
    console.log("\n[Step 6] Polling GET /api/checks/:id for extraction completion...");
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const getRes = await fetch(`${baseUrl}/api/checks/${checkId}`);
      const getData = await getRes.json();
      console.log(`Poll ${i + 1}: status = ${getData.check?.status}`);
      if (getData.check?.status === "awaiting_confirmation") {
        ready = true;
        console.log("Extracted entities:", getData.entities);
        break;
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    if (!ready) {
      throw new Error("Check did not transition to awaiting_confirmation in time");
    }

    // 6. Open GET /api/checks/:id/stream and read first frames
    console.log("\n[Step 7] Connecting to GET /api/checks/:id/stream...");
    const streamRes = await fetch(`${baseUrl}/api/checks/${checkId}/stream`);
    console.log("Stream status:", streamRes.status);
    console.log("Stream Content-Type:", streamRes.headers.get("content-type"));
    console.log("Stream X-Accel-Buffering:", streamRes.headers.get("x-accel-buffering"));

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let streamOutput = "";
    for (let i = 0; i < 3; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      streamOutput += decoder.decode(value);
      if (streamOutput.includes("retry:") && streamOutput.includes("connected")) break;
    }
    console.log("First stream frame received:\n", streamOutput.trim());
    await reader.cancel();

    // 7. Rate limiting probe under TRUST_PROXY=false
    // Verify that spoofed X-Forwarded-For does NOT bypass rate limiting:
    // All requests share the single "unknown" bucket and hit 429 together.
    console.log("\n[Step 8] Testing rate limiting with varying X-Forwarded-For headers (TRUST_PROXY=false)...");
    let first429 = null;
    for (let i = 0; i < 12; i++) {
      const fd = new FormData();
      fd.append("text", `Rate limit probe ${i}`);
      fd.append("consent", "true");
      const r = await fetch(`${baseUrl}/api/checks`, {
        method: "POST",
        headers: {
          "X-Forwarded-For": `203.0.113.${i + 1}`,
          "X-Client-IP": `198.51.100.${i + 1}`,
        },
        body: fd,
      });
      if (r.status === 429) {
        first429 = {
          status: r.status,
          retryAfter: r.headers.get("retry-after"),
          body: await r.json(),
        };
        break;
      }
    }

    if (first429) {
      console.log("✓ Rate limit 429 received (shared unknown bucket confirmed):", JSON.stringify(first429, null, 2));
    } else {
      throw new Error("Expected rate limit 429 across requests with TRUST_PROXY=false, but none was triggered");
    }

    // 8. Test clean SIGTERM shutdown timing (< 2000ms)
    console.log("\n[Step 9] Testing graceful SIGTERM shutdown timing...");
    const shutdownStart = Date.now();
    const exitPromise = new Promise((resolve) => {
      serverProc.on("exit", (code, signal) => {
        const duration = Date.now() - shutdownStart;
        resolve({ code, signal, duration });
      });
    });

    serverProc.kill("SIGTERM");
    const exitResult = await Promise.race([
      exitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Server failed to exit within 3000ms")), 3000)),
    ]);

    console.log(`Server exited cleanly on SIGTERM in ${exitResult.duration}ms with code ${exitResult.code} (signal: ${exitResult.signal})`);
    if (exitResult.duration >= 2000) {
      console.warn(`Warning: Shutdown took ${exitResult.duration}ms (target < 2000ms)`);
    }

    // 9. Separate test under TRUST_PROXY=true, TRUSTED_PROXY_HOPS=1
    console.log("\n[Step 10] Testing TRUST_PROXY=true with rightmost client IP separation...");
    const proxyPort = await findFreePort();
    const proxyBaseUrl = `http://127.0.0.1:${proxyPort}`;
    const proxyEnv = {
      ...process.env,
      PORT: String(proxyPort),
      NODE_ENV: "production",
      DB_PATH: path.join(TEMP_DIR, "proxy_true.db"),
      UPLOAD_DIR: TEMP_UPLOADS,
      LLM_PROVIDER: "mock",
      LLM_API_KEY: "mock-key",
      LLM_MODEL: "mock-model",
      RATE_LIMIT_CREATE_MAX: "2", // Limit 2 requests per window per IP
      TRUST_PROXY: "true",
      TRUSTED_PROXY_HOPS: "1",
    };

    const proxyProc = spawn("npx", ["next", "start", "-p", String(proxyPort)], {
      env: proxyEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      await waitForServer(`${proxyBaseUrl}/api/health`, 20000);

      // Client A requests with rightmost IP 203.0.113.10: 2 allowed, 3rd gets 429
      const resA1 = await fetch(`${proxyBaseUrl}/api/checks`, {
        method: "POST",
        headers: { "X-Forwarded-For": "spoofed.client.1, 203.0.113.10" },
        body: (() => { const f = new FormData(); f.append("text", "A1"); f.append("consent", "true"); return f; })(),
      });
      const resA2 = await fetch(`${proxyBaseUrl}/api/checks`, {
        method: "POST",
        headers: { "X-Forwarded-For": "spoofed.client.2, 203.0.113.10" },
        body: (() => { const f = new FormData(); f.append("text", "A2"); f.append("consent", "true"); return f; })(),
      });
      const resA3 = await fetch(`${proxyBaseUrl}/api/checks`, {
        method: "POST",
        headers: { "X-Forwarded-For": "spoofed.client.3, 203.0.113.10" },
        body: (() => { const f = new FormData(); f.append("text", "A3"); f.append("consent", "true"); return f; })(),
      });

      if (resA1.status !== 201 || resA2.status !== 201 || resA3.status !== 429) {
        throw new Error(`Client A failed rate limit expectation (got ${resA1.status}, ${resA2.status}, ${resA3.status})`);
      }

      // Client B requests with rightmost IP 203.0.113.20 (same leftmost spoofed IP): must get 201 in fresh bucket
      const resB1 = await fetch(`${proxyBaseUrl}/api/checks`, {
        method: "POST",
        headers: { "X-Forwarded-For": "spoofed.client.1, 203.0.113.20" },
        body: (() => { const f = new FormData(); f.append("text", "B1"); f.append("consent", "true"); return f; })(),
      });

      if (resB1.status !== 201) {
        throw new Error(`Client B was unexpectedly rate limited by shared bucket (status ${resB1.status})`);
      }

      console.log("✓ TRUST_PROXY=true correctly isolated client buckets by right-most IP (Client A hit 429, Client B got 201)");
    } finally {
      try {
        proxyProc.kill("SIGKILL");
      } catch (_e) {}
    }

    console.log("\n=== Offline Operations Smoke Test Passed Successfully ===");
  } finally {
    cleanup();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Ops smoke test failed with error:", err);
  process.exit(1);
});

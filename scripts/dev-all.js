#!/usr/bin/env node
/**
 * scripts/dev-all.js
 *
 * Runs the Next.js frontend/API server concurrently with the Python FastAPI
 * ML classifier microservice and the Node/Playwright crawler microservice.
 * Handles graceful shutdown of all processes on SIGINT / SIGTERM.
 */

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";

const rootDir = process.cwd();

// Load .env.local if present
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // Ignore if .env.local is missing
}

// Ensure CRAWLER_API_KEY has a local development default if not already set
if (!process.env.CRAWLER_API_KEY) {
  process.env.CRAWLER_API_KEY = "dev-crawler-key";
}

const venvPython = path.join(rootDir, "services", "classifier", ".venv", "bin", "python");
const pythonCmd = fs.existsSync(venvPython) ? venvPython : "python3";
const modelFile = path.join(rootDir, "services", "classifier", "model.joblib");

if (!fs.existsSync(modelFile)) {
  console.log("[dev:all] Classifier model.joblib missing. Training model automatically...");
  const trainPy = path.join(rootDir, "services", "classifier", "train.py");
  const trainRes = spawnSync(pythonCmd, [trainPy], {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: rootDir },
  });
  if (trainRes.status !== 0) {
    console.error("[dev:all] Classifier model training failed with exit code:", trainRes.status);
    process.exit(1);
  }
  console.log("[dev:all] Classifier model trained successfully.");
}

console.log("[dev:all] Starting Python classifier service on http://127.0.0.1:8000...");
const classifierProc = spawn(pythonCmd, [
  "-m", "uvicorn", "services.classifier.app:app",
  "--host", "127.0.0.1",
  "--port", "8000"
], {
  cwd: rootDir,
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, PYTHONPATH: rootDir },
});

classifierProc.stdout.on("data", (data) => {
  const line = data.toString().trim();
  if (line) console.log(`[classifier] ${line}`);
});

classifierProc.stderr.on("data", (data) => {
  const line = data.toString().trim();
  if (line) console.error(`[classifier] ${line}`);
});

console.log("[dev:all] Starting crawler microservice on http://127.0.0.1:3001...");
const crawlerProc = spawn("node", ["services/crawler/src/server.js"], {
  cwd: rootDir,
  stdio: ["inherit", "pipe", "pipe"],
  env: { ...process.env, PORT: "3001" },
});

crawlerProc.stdout.on("data", (data) => {
  const line = data.toString().trim();
  if (line) console.log(`[crawler] ${line}`);
});

crawlerProc.stderr.on("data", (data) => {
  const line = data.toString().trim();
  if (line) console.error(`[crawler] ${line}`);
});

console.log("[dev:all] Starting Next.js app server...");
const nextProc = spawn("npm", ["run", "dev"], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});

function cleanup(code = 0) {
  console.log("\n[dev:all] Shutting down services...");
  try {
    classifierProc.kill("SIGINT");
  } catch {}
  try {
    crawlerProc.kill("SIGINT");
  } catch {}
  try {
    nextProc.kill("SIGINT");
  } catch {}
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

classifierProc.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.warn(`[dev:all] Classifier process exited with code ${code}`);
  }
});

crawlerProc.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.warn(`[dev:all] Crawler process exited with code ${code}`);
  }
});

nextProc.on("exit", (code) => {
  cleanup(code || 0);
});

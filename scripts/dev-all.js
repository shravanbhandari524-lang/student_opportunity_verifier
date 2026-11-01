#!/usr/bin/env node
/**
 * scripts/dev-all.js
 *
 * Runs the Next.js frontend/API server concurrently with the Python FastAPI
 * ML classifier microservice. Handles graceful shutdown of both processes
 * on SIGINT / SIGTERM.
 */

import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";

const rootDir = process.cwd();
const venvPython = path.join(rootDir, "services", "classifier", ".venv", "bin", "python");
const pythonCmd = fs.existsSync(venvPython) ? venvPython : "python3";

console.log("[dev:all] Starting Python classifier service...");
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

nextProc.on("exit", (code) => {
  cleanup(code || 0);
});

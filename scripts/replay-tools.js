#!/usr/bin/env node
/**
 * scripts/replay-tools.js
 *
 * Maintenance and verification CLI tool for recorded model and search fixtures.
 *
 * Commands:
 *   node scripts/replay-tools.js list [--dir <path>]
 *     Lists all recordings in the recordings directory with type, key, size, and date.
 *
 *   node scripts/replay-tools.js verify [--dir <path>]
 *     Scans every recording file for:
 *     - Malformed JSON
 *     - Missing required fields (key, type, result)
 *     - Secret keys, API tokens, Authorization headers, Bearer tokens, or credentials
 *     Exits with non-zero code (1) if any secret pattern or corruption is detected.
 *
 *   node scripts/replay-tools.js prune --age-days <N> [--yes] [--dir <path>]
 *     Prunes recordings older than N days.
 *     Requires --yes flag to actually delete files; otherwise runs in dry-run mode.
 */

import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../lib/env.js";

// Common secret patterns that must NEVER appear in recordings
const SUSPICIOUS_SECRET_PATTERNS = [
  /AIza[0-9A-Za-z-_]{35}/,                         // Google Gemini / Firebase API keys
  /sk-[0-9a-zA-Z]{20,}/,                          // OpenAI / generic API keys
  /bearer\s+[a-zA-Z0-9_\-\.]{20,}/i,               // Bearer tokens
  /authorization:\s*bearer/i,                     // Authorization headers
  /"authorization":\s*"[^"]+"/i,                  // Serialized auth header
  /"x-api-key":\s*"[^"]+"/i,                      // Serialized x-api-key header
  /secret_key/i,
];

/**
 * Parses CLI arguments.
 */
function parseArgs(args) {
  const parsed = {
    command: args[0] || "list",
    dir: null,
    ageDays: null,
    yes: false,
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      parsed.dir = args[++i];
    } else if (args[i] === "--age-days" && args[i + 1]) {
      parsed.ageDays = parseFloat(args[++i]);
    } else if (args[i] === "--yes") {
      parsed.yes = true;
    }
  }

  return parsed;
}

/**
 * Returns list of .json recording files in the directory.
 */
async function getRecordingFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => path.join(dir, e.name));
}

/**
 * List command: displays table of recordings.
 */
async function cmdList(dir) {
  console.log(`Directory: ${dir}`);
  const files = await getRecordingFiles(dir);

  if (files.length === 0) {
    console.log("No recordings found.");
    return 0;
  }

  console.log(`Found ${files.length} recording(s):`);
  console.log("--------------------------------------------------------------------------------");
  console.log("Key                                                               Type          Size (KB)  Recorded At");
  console.log("--------------------------------------------------------------------------------");

  for (const file of files) {
    try {
      const content = await fs.promises.readFile(file, "utf8");
      const stat = await fs.promises.stat(file);
      const parsed = JSON.parse(content);
      const key = parsed.key || path.basename(file, ".json");
      const type = parsed.type || "unknown";
      const sizeKb = (stat.size / 1024).toFixed(1);
      const recordedAt = parsed.recordedAt || stat.mtime.toISOString();

      console.log(`${key.padEnd(64)}  ${type.padEnd(12)}  ${sizeKb.padStart(8)}  ${recordedAt}`);
    } catch {
      console.log(`${path.basename(file).padEnd(64)}  [CORRUPTED]`);
    }
  }

  return 0;
}

/**
 * Verify command: checks for corruption and leaks.
 */
async function cmdVerify(dir) {
  console.log(`Verifying recordings in: ${dir}`);
  const files = await getRecordingFiles(dir);

  if (files.length === 0) {
    console.log("No recordings to verify.");
    return 0;
  }

  let errorCount = 0;

  for (const file of files) {
    const filename = path.basename(file);
    try {
      const rawText = await fs.promises.readFile(file, "utf8");

      // 1. Check for secret patterns
      for (const pattern of SUSPICIOUS_SECRET_PATTERNS) {
        if (pattern.test(rawText)) {
          console.error(`ERROR: [${filename}] contains sensitive key or token pattern matching ${pattern}`);
          errorCount++;
        }
      }

      // 2. Parse JSON
      const parsed = JSON.parse(rawText);
      if (!parsed.key) {
        console.error(`ERROR: [${filename}] is missing required 'key' field`);
        errorCount++;
      }
      if (!parsed.type) {
        console.error(`ERROR: [${filename}] is missing required 'type' field`);
        errorCount++;
      }
      if (parsed.result === undefined) {
        console.error(`ERROR: [${filename}] is missing required 'result' field`);
        errorCount++;
      }
    } catch (err) {
      console.error(`ERROR: [${filename}] failed JSON parse: ${err.message}`);
      errorCount++;
    }
  }

  if (errorCount > 0) {
    console.error(`\nVerification FAILED: ${errorCount} issue(s) detected.`);
    return 1;
  }

  console.log(`\nVerification PASSED: All ${files.length} recording(s) clean and valid.`);
  return 0;
}

/**
 * Prune command: removes recordings older than N days.
 */
async function cmdPrune(dir, ageDays, yes) {
  if (ageDays === null || isNaN(ageDays) || ageDays < 0) {
    console.error("ERROR: --age-days <N> must be specified as a non-negative number");
    return 1;
  }

  const files = await getRecordingFiles(dir);
  const now = Date.now();
  const maxAgeMs = ageDays * 24 * 60 * 60 * 1000;
  const toDelete = [];

  for (const file of files) {
    const stat = await fs.promises.stat(file);
    let itemDate = stat.mtimeMs;

    try {
      const raw = await fs.promises.readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.recordedAt) {
        const parsedMs = Date.parse(parsed.recordedAt);
        if (!isNaN(parsedMs)) itemDate = parsedMs;
      }
    } catch {
      // Use mtimeMs on parse error
    }

    if (now - itemDate >= maxAgeMs) {
      toDelete.push(file);
    }
  }

  if (toDelete.length === 0) {
    console.log(`No recordings older than ${ageDays} day(s) found.`);
    return 0;
  }

  if (!yes) {
    console.log(`DRY-RUN: Found ${toDelete.length} recording(s) older than ${ageDays} day(s) to prune:`);
    for (const f of toDelete) {
      console.log(` - ${path.basename(f)}`);
    }
    console.log("\nRe-run with --yes to perform actual deletion.");
    return 0;
  }

  console.log(`Pruning ${toDelete.length} recording(s)...`);
  for (const f of toDelete) {
    await fs.promises.unlink(f);
    console.log(` - Deleted ${path.basename(f)}`);
  }
  console.log("Prune completed successfully.");
  return 0;
}

/**
 * Main CLI entrypoint.
 */
async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);
  let targetDir = parsed.dir;
  if (!targetDir) {
    try {
      const env = getEnv(process.env);
      targetDir = env.RECORD_REPLAY_DIR;
    } catch {
      targetDir = process.env.RECORD_REPLAY_DIR || ".recordings";
    }
  }
  if (!targetDir) targetDir = ".recordings";

  let exitCode = 0;
  switch (parsed.command) {
    case "list":
      exitCode = await cmdList(targetDir);
      break;
    case "verify":
      exitCode = await cmdVerify(targetDir);
      break;
    case "prune":
      exitCode = await cmdPrune(targetDir, parsed.ageDays, parsed.yes);
      break;
    default:
      console.error(`Unknown command: ${parsed.command}`);
      console.error("Usage: node scripts/replay-tools.js [list|verify|prune] [options]");
      exitCode = 1;
      break;
  }

  process.exit(exitCode);
}

import { fileURLToPath } from "node:url";

// Only execute when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

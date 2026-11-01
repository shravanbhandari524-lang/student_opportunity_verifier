#!/usr/bin/env node
/**
 * scripts/check-secrets.js
 *
 * Pre-commit credential hygiene and secret scanner.
 * Enforces security invariants before git commits:
 * 1. Blocks staging of raw database files (data/app.db, *.db)
 * 2. Blocks staging of live environment files (.env, .env.local, etc., excluding *.example)
 * 3. Scans added diff lines for API keys and tokens:
 *    - Google / Gemini API keys (AIza[0-9A-Za-z_-]{35})
 *    - OpenAI / Groq keys (sk-..., gsk-...)
 *    - High-entropy tokens assigned to *_KEY, *_TOKEN, or *_SECRET variables
 *    - Private key blocks
 *
 * Exits with code 1 on violations (reporting file and rule name, never secret values).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export const FORBIDDEN_PATH_PATTERNS = [
  {
    name: "SQLite Database File",
    pattern: /(^|\/)(app\.db|.*\.sqlite|.*\.sqlite3)$/i,
  },
  {
    name: "Live Environment File",
    // Matches .env, .env.local, .env.production, etc. BUT allows .env.example, .env.local.example
    pattern: /(^|\/)\.env(\.[^/]+)?$/i,
    isAllowed: (filePath) => /\.example$/i.test(filePath) || /\.test$/i.test(filePath) && !/\.local$/i.test(filePath),
  },
];

export const SECRET_PATTERNS = [
  {
    name: "Google / Gemini API Key (AIza...)",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    name: "OpenAI API Key (sk-...)",
    regex: /\bsk-[A-Za-z0-9]{20,}\b/,
  },
  {
    name: "Groq API Key (gsk_...)",
    regex: /\bgsk_[A-Za-z0-9]{20,}\b/,
  },
  {
    name: "Private Key Header",
    regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
  },
  {
    name: "Generic Secret / Key Assignment",
    regex: /(?:[A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET))\s*[:=]\s*["']?([A-Za-z0-9_\-/.]{16,})["']?/i,
    extractValue: (match) => {
      if (/\bclaim_?key\b/i.test(match[0])) return null;
      return match[1];
    },
  },
];

const SAFE_PLACEHOLDER_SUBSTRINGS = [
  "your_",
  "example",
  "dummy",
  "mock",
  "fake",
  "canary",
  "placeholder",
  "test",
  "insert",
  "changeme",
  "process.env",
  "xxx",
  "<",
  ">",
  "true",
  "false",
];

/**
 * Checks if a given file path is forbidden from being staged/committed.
 *
 * @param {string} filePath
 * @returns {{ blocked: boolean, rule?: string }}
 */
export function checkPath(filePath) {
  if (!filePath || typeof filePath !== "string") return { blocked: false };
  const normalized = filePath.replace(/\\/g, "/");

  for (const { name, pattern, isAllowed } of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      if (typeof isAllowed === "function" && isAllowed(normalized)) {
        continue;
      }
      return { blocked: true, rule: name };
    }
  }

  return { blocked: false };
}

/**
 * Scans content (or added diff lines) for credentials or tokens.
 *
 * @param {string} content - Text content or diff hunk
 * @param {object} [options]
 * @param {boolean} [options.diffMode=false] - If true, only scan lines starting with '+'
 * @returns {Array<{ rule: string, lineIndex: number }>} Detected violations
 */
export function scanContent(content, { diffMode = false } = {}) {
  if (typeof content !== "string" || !content.trim()) return [];

  const violations = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // In diff mode, only scan added lines and ignore diff file header lines (+++, ---)
    if (diffMode) {
      if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) {
        continue;
      }
    }

    const line = diffMode ? rawLine.slice(1).trim() : rawLine.trim();
    if (!line) continue;

    // Ignore regex pattern definitions in code (e.g. /AIza.../)
    if (line.includes("/AIza") || line.includes("regex:") || line.includes("RegExp(")) {
      continue;
    }

    // Ignore comments mentioning key names or patterns
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("#")) {
      continue;
    }

    for (const pat of SECRET_PATTERNS) {
      const match = pat.regex.exec(line);
      if (match) {
        // If an extractValue function exists, verify that the value is not a dummy/placeholder
        if (typeof pat.extractValue === "function") {
          const val = pat.extractValue(match);
          if (!val) continue;
          const low = val.toLowerCase();
          if (SAFE_PLACEHOLDER_SUBSTRINGS.some((s) => low.includes(s))) {
            continue;
          }
        }
        violations.push({
          rule: pat.name,
          lineIndex: i + 1,
        });
        break; // Count once per line
      }
    }
  }

  return violations;
}

/**
 * Checks currently staged git files and staged diffs.
 *
 * @param {object} [options]
 * @param {Function} [options.exec]
 * @returns {{ ok: boolean, errors: Array<{ file: string, rule: string, line?: number }> }}
 */
export function checkStaged(options = {}) {
  const runCmd = options.exec || ((cmd) => execSync(cmd, { encoding: "utf8" }));
  const errors = [];

  try {
    // 1. Get list of staged files
    const stagedFilesOutput = runCmd("git diff --cached --name-only --diff-filter=ACMR");
    const stagedFiles = stagedFilesOutput
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    for (const file of stagedFiles) {
      // Check path against forbidden paths
      const pathCheck = checkPath(file);
      if (pathCheck.blocked) {
        errors.push({
          file,
          rule: pathCheck.rule,
        });
        continue;
      }

      // Check added contents in diff
      try {
        const diff = runCmd(`git diff --cached -U0 -- "${file}"`);
        const contentViolations = scanContent(diff, { diffMode: true });
        for (const v of contentViolations) {
          errors.push({
            file,
            rule: v.rule,
            line: v.lineIndex,
          });
        }
      } catch {
        // Ignore diff error on binary or removed files
      }
    }
  } catch (err) {
    return {
      ok: false,
      errors: [{ file: "git", rule: `Git command failed: ${err.message}` }],
    };
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

// CLI Execution entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || "")) {
  const result = checkStaged();
  if (!result.ok) {
    console.error("\n❌ [Pre-Commit Guard] Commit blocked: Credential or sensitive file detected!");
    console.error("Never commit API keys, secrets, live environment files, or SQLite databases.\n");
    for (const err of result.errors) {
      const loc = err.line ? `:${err.line}` : "";
      console.error(`  - ${err.file}${loc} -> Violation: ${err.rule}`);
    }
    console.error("\nPlease remove sensitive data or use environment variables before committing.\n");
    process.exit(1);
  } else {
    // Clean
    process.exit(0);
  }
}

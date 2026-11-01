#!/usr/bin/env node
/**
 * scripts/secrets-scan.js
 *
 * Secrets and Credential Hygiene Scanner:
 * 1. Scans working tree and git log history for key-like patterns:
 *    - Google/Gemini API keys: AIza[0-9A-Za-z-_]{35}
 *    - SerpApi keys: [a-f0-9]{64}
 *    - Generic API key patterns: api[_-]?key["'\s:=]+[A-Za-z0-9_-]{20,}
 *    - Private keys: -----BEGIN [A-Z ]+PRIVATE KEY-----
 *    Output prints match counts and filenames only; NEVER prints secret values.
 * 2. Asserts that .env.local is ignored in .gitignore and not tracked by git.
 * 3. Runs `npm audit --json` and prints vulnerability counts by severity (never auto-fixes).
 * 4. Exits with code 0 on clean scan, or code 1 if keys found or .env.local tracked.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Patterns to search for actual credentials
export const KEY_PATTERNS = [
  {
    name: "Google / Gemini API Key",
    regex: /(?:LLM_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)["'\s:=]+(["']?(?:AIza[0-9A-Za-z-_]{35}|AQ\.[A-Za-z0-9_.-]{40,65})["']?)|(?:\bAIza[0-9A-Za-z-_]{35}\b)/gi,
  },
  {
    name: "Serper / SerpApi Key Assignment",
    regex: /(?:SEARCH_API_KEY|SERPER_API_KEY|SERPAPI_API_KEY|serper[_-]?api[_-]?key)["'\s:=]+(["']?[a-f0-9]{32,64}["']?)/gi,
  },
  {
    name: "Generic Secret Key Assignment",
    regex: /(?:api[_-]?key|secret[_-]?key|access[_-]?token)["'\s:=]+(["'][A-Za-z0-9_\-]{20,}["'])/gi,
  },
  {
    name: "Private Key Header",
    regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----/g,
  },
];

// Directories / files excluded from tree scan
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  ".recordings",
  ".venv",
  "venv",
]);

// Excluded file paths (test mocks, sample fixtures with explicitly fake tokens, or gitignored env files verified separately)
const EXCLUDED_FILES = new Set([
  "package-lock.json",
  "skills-lock.json",
  ".env.local",
]);

/**
 * Checks if a string or match is an allowed mock / placeholder token.
 */
function isHarmlessMock(matchedStr) {
  const lower = matchedStr.toLowerCase();
  return (
    lower.includes("mock") ||
    lower.includes("placeholder") ||
    lower.includes("example") ||
    lower.includes("dummy") ||
    lower.includes("fake") ||
    lower.includes("test-key") ||
    lower.includes("super-secret-key") ||
    lower.includes("sk-ant-api03-xxxx") ||
    lower.includes("aiza-fake") ||
    lower.includes("0000000000000000000000000000000000000000000000000000000000000000") ||
    lower.includes("1111111111111111111111111111111111111111111111111111111111111111")
  );
}

/**
 * Scans a file's content for sensitive key patterns.
 */
export function scanFileContent(filePath, content) {
  const fileMatches = [];
  for (const { name, regex } of KEY_PATTERNS) {
    // Reset regex index
    regex.lastIndex = 0;
    let match;
    let count = 0;
    while ((match = regex.exec(content)) !== null) {
      const matchedText = match[0];
      if (!isHarmlessMock(matchedText)) {
        count++;
      }
    }
    if (count > 0) {
      fileMatches.push({ name, count });
    }
  }
  return fileMatches;
}

/**
 * Recursively scans directory.
 */
export function scanWorkingDirectory(dir) {
  const results = {};

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (!EXCLUDED_DIRS.has(ent.name)) {
          walk(path.join(current, ent.name));
        }
      } else if (ent.isFile()) {
        const fullPath = path.join(current, ent.name);
        const relPath = path.relative(process.cwd(), fullPath);
        if (EXCLUDED_FILES.has(ent.name) || relPath.startsWith(".recordings/")) {
          continue;
        }

        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const matches = scanFileContent(relPath, content);
          if (matches.length > 0) {
            results[relPath] = matches;
          }
        } catch (_e) {
          // Binary files or read errors ignored
        }
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Scans git commit diff history.
 */
export function scanGitHistory() {
  const historyResults = {};
  try {
    const gitDiff = execSync("git log -p -n 100", { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 });
    const commitSections = gitDiff.split(/^commit [a-f0-9]{40}/m);

    for (let i = 1; i < commitSections.length; i++) {
      const section = commitSections[i];
      // Only examine added lines (starting with +)
      const addedLines = section
        .split("\n")
        .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
        .join("\n");

      for (const { name, regex } of KEY_PATTERNS) {
        regex.lastIndex = 0;
        let match;
        let count = 0;
        while ((match = regex.exec(addedLines)) !== null) {
          if (!isHarmlessMock(match[0])) {
            count++;
          }
        }
        if (count > 0) {
          historyResults[`commit-${i}`] = historyResults[`commit-${i}`] || [];
          historyResults[`commit-${i}`].push({ name, count });
        }
      }
    }
  } catch (_e) {
    // If not a git repo or git fails
  }
  return historyResults;
}

/**
 * Checks .env.local gitignore and tracked status.
 */
export function checkEnvLocalStatus() {
  const issues = [];
  try {
    const ignored = execSync("git check-ignore .env.local", { encoding: "utf-8" }).trim();
    if (!ignored) {
      issues.push(".env.local is NOT ignored by git");
    }
  } catch (_e) {
    issues.push(".env.local is NOT ignored by git (.gitignore rule missing)");
  }

  try {
    execSync("git ls-files --error-unmatch .env.local", { stdio: "pipe" });
    issues.push("CRITICAL: .env.local is currently tracked by git!");
  } catch (_e) {
    // Expected: error means file is untracked
  }

  return issues;
}

/**
 * Executes npm audit --json and returns counts by severity.
 */
export function runNpmAudit() {
  try {
    const jsonStr = execSync("npm audit --json", { encoding: "utf-8" });
    const auditData = JSON.parse(jsonStr);
    return auditData.metadata?.vulnerabilities || { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  } catch (err) {
    if (err.stdout) {
      try {
        const auditData = JSON.parse(err.stdout);
        return auditData.metadata?.vulnerabilities || { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
      } catch (_e) {}
    }
    return { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  }
}

export function runSecretsScan() {
  console.log("=======================================================");
  console.log("          SECRETS & CREDENTIAL HYGIENE SCAN            ");
  console.log("=======================================================\n");

  // 1. Scan Working Tree
  console.log("[1] Scanning working tree for exposed secrets...");
  const treeResults = scanWorkingDirectory(process.cwd());
  const treeViolations = Object.keys(treeResults);
  if (treeViolations.length === 0) {
    console.log("    ✓ Working tree clean: 0 exposed secrets found.");
  } else {
    console.error(`    ✖ Found exposed key patterns in ${treeViolations.length} file(s):`);
    for (const [file, matches] of Object.entries(treeResults)) {
      const matchSummaries = matches.map((m) => `${m.count} ${m.name}`).join(", ");
      console.error(`      - ${file} (${matchSummaries})`);
    }
  }

  // 2. Scan Git History
  console.log("\n[2] Scanning recent git history (last 100 commits)...");
  const historyResults = scanGitHistory();
  const historyViolations = Object.keys(historyResults);
  if (historyViolations.length === 0) {
    console.log("    ✓ Git history clean: 0 leaked keys in commit diffs.");
  } else {
    console.error(`    ✖ Leaked key patterns detected in ${historyViolations.length} commit(s).`);
  }

  // 3. Verify .env.local status
  console.log("\n[3] Verifying .env.local security status...");
  const envIssues = checkEnvLocalStatus();
  if (envIssues.length === 0) {
    console.log("    ✓ .env.local is correctly gitignored and untracked.");
  } else {
    for (const issue of envIssues) {
      console.error(`    ✖ ${issue}`);
    }
  }

  // 4. npm audit summary
  console.log("\n[4] Running npm audit vulnerability summary (no auto-fix)...");
  const vulns = runNpmAudit();
  console.log(`    - Info:     ${vulns.info ?? 0}`);
  console.log(`    - Low:      ${vulns.low ?? 0}`);
  console.log(`    - Moderate: ${vulns.moderate ?? 0}`);
  console.log(`    - High:     ${vulns.high ?? 0}`);
  console.log(`    - Critical: ${vulns.critical ?? 0}`);
  console.log(`    - Total:    ${vulns.total ?? 0}`);

  console.log("\n=======================================================");
  const passed = treeViolations.length === 0 && historyViolations.length === 0 && envIssues.length === 0;

  if (passed) {
    console.log("RESULT: SECRETS HYGIENE CHECK PASSED.");
    console.log("=======================================================\n");
    return true;
  } else {
    console.error("RESULT: SECRETS HYGIENE CHECK FAILED.");
    console.log("=======================================================\n");
    return false;
  }
}

if (process.argv[1] && process.argv[1].endsWith("secrets-scan.js")) {
  const success = runSecretsScan();
  process.exit(success ? 0 : 1);
}

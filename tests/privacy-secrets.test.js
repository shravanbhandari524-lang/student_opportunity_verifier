import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import Database from "better-sqlite3";

import {
  MARKERS,
  scanDatabaseForMarkers,
  scanDirectoryForMarkers,
  scanLogsForMarkers,
  scanResponsesForMarkers,
  runPrivacyAudit,
} from "../scripts/privacy-check.js";
import {
  KEY_PATTERNS,
  scanFileContent,
  scanWorkingDirectory,
  checkEnvLocalStatus,
} from "../scripts/secrets-scan.js";

describe("L7 Ops: Privacy and Secrets Verification", () => {
  describe("Privacy Scanner", () => {
    it("detects deliberate marker in database table column", () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE test_table (id TEXT, note TEXT);");
      db.prepare("INSERT INTO test_table (id, note) VALUES (?, ?)").run(
        "1",
        `Confidential data containing ${MARKERS.MSG_TEXT}`
      );

      const matches = scanDatabaseForMarkers(db);
      assert.equal(matches.MSG_TEXT.length, 1);
      assert.ok(matches.MSG_TEXT[0].includes("test_table.note"));
      assert.equal(matches.UPI_VAL.length, 0);
      db.close();
    });

    it("detects deliberate marker in captured log entry", () => {
      const cleanLogs = [{ level: "info", msg: "Clean system event", obj: { status: "ok" } }];
      const cleanMatches = scanLogsForMarkers(cleanLogs);
      assert.equal(cleanMatches.MSG_TEXT.length, 0);

      const taintedLogs = [
        { level: "info", msg: "Request received", obj: { userMessage: `Payload with ${MARKERS.MSG_TEXT}` } },
        { level: "warn", msg: `Warning: ${MARKERS.COMMENT_PII}`, obj: {} },
      ];
      const taintedMatches = scanLogsForMarkers(taintedLogs);
      assert.equal(taintedMatches.MSG_TEXT.length, 1);
      assert.equal(taintedMatches.COMMENT_PII.length, 1);
    });

    it("detects deliberate marker in API response body", () => {
      const cleanResponses = [{ riskLevel: "low", score: 0 }];
      assert.equal(scanResponsesForMarkers(cleanResponses).MSG_TEXT.length, 0);

      const taintedResponses = [
        { riskLevel: "high", details: { email: MARKERS.COMMENT_PII } },
      ];
      const taintedMatches = scanResponsesForMarkers(taintedResponses);
      assert.equal(taintedMatches.COMMENT_PII.length, 1);
    });

    it("detects deliberate marker in filesystem directory file", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "priv-test-"));
      try {
        const filePath = path.join(tmpDir, "sample.txt");
        fs.writeFileSync(filePath, `Stored content with ${MARKERS.MSG_TEXT}`, "utf-8");

        const matches = scanDirectoryForMarkers(tmpDir);
        assert.equal(matches.MSG_TEXT.length, 1);
        assert.equal(matches.MSG_TEXT[0], filePath);
        assert.equal(matches.UPI_VAL.length, 0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("runs runPrivacyAudit cleanly without violations and passes 24h retention check", async () => {
      const result = await runPrivacyAudit();
      assert.equal(result.passed, true);
      assert.equal(result.violations.length, 0);
      assert.equal(result.postDbMatches.MSG_TEXT.length, 0);
      assert.equal(result.logMatches.MSG_TEXT.length, 0);
      assert.equal(result.logMatches.COMMENT_PII.length, 0);
      assert.equal(result.respMatches.COMMENT_PII.length, 0);
    });

    it("cli --expect-fail exits 0 when violation occurs and 1 when clean", () => {
      // In a clean repository run, privacy-check exits 0 normally,
      // so running with --expect-fail should exit non-zero (exit code 1)
      assert.throws(() => {
        execSync("node scripts/privacy-check.js --expect-fail", {
          encoding: "utf-8",
          stdio: "pipe",
        });
      }, /Command failed/i);
    });
  });

  describe("Secrets Scanner", () => {
    it("detects exposed Google/Gemini key pattern in a file without printing value", () => {
      // 39 char AIza string
      const fakeGoogleKey = "AIzaSy" + "A".repeat(33);
      const content = `const key = "${fakeGoogleKey}";`;
      const matches = scanFileContent("dummy.js", content);
      assert.ok(matches.length > 0);
      assert.equal(matches[0].name, "Google / Gemini API Key");
      assert.equal(matches[0].count, 1);
      // Ensure match object only contains pattern name and count, not secret value
      assert.deepEqual(Object.keys(matches[0]), ["name", "count"]);
    });

    it("detects unquoted LLM_API_KEY with AQ. prefix shape (dynamically generated fake token)", () => {
      // Fake AQ token shape: AQ. followed by 45 base64url characters
      const fakeAqToken = "AQ." + "Z".repeat(45);
      const envContent = `LLM_API_KEY=${fakeAqToken}\n`;
      const matches = scanFileContent("config.env", envContent);
      assert.ok(matches.length > 0);
      assert.equal(matches[0].name, "Google / Gemini API Key");
      assert.equal(matches[0].count, 1);
    });

    it("detects exposed Serper API key pattern in a file without printing value", () => {
      const fakeSerperKey = "a1b2c3d4e5f6".repeat(5) + "a1b2"; // 64 hex chars
      const content = `SERPER_API_KEY="${fakeSerperKey}"`;
      const matches = scanFileContent(".env", content);
      assert.ok(matches.length > 0);
      assert.ok(matches.some((m) => m.name.includes("Serper")));
    });

    it("detects unquoted SEARCH_API_KEY 40-char hex key (dynamically generated fake token)", () => {
      const fakeSearchKey = "c0ffee".repeat(6) + "abcd"; // 40 hex chars
      const envContent = `SEARCH_API_KEY=${fakeSearchKey}\n`;
      const matches = scanFileContent("search.env", envContent);
      assert.ok(matches.length > 0);
      assert.ok(matches.some((m) => m.name.includes("Serper")));
      assert.equal(matches[0].count, 1);
    });

    it("does NOT trigger on ordinary 40-character hex strings or git hashes in code or text", () => {
      const gitCommitHash = "c780608c7eb206d5b67be0ac3ad770559d83f1aa";
      const sampleText = `Commit ref is ${gitCommitHash} and another sha is 0123456789abcdef0123456789abcdef01234567`;
      const matches = scanFileContent("readme.txt", sampleText);
      assert.equal(matches.length, 0, "Ordinary 40-char hex strings must not trigger false alarms");
    });

    it("detects private key header pattern in a file", () => {
      const header = ["-----BEGIN", "RSA", "PRIVATE", "KEY-----"].join(" ");
      const content = `${header}\nMIIEowIBAAKCAQEA...`;
      const matches = scanFileContent("server.key", content);
      assert.ok(matches.length > 0);
      assert.equal(matches[0].name, "Private Key Header");
    });

    it("scanWorkingDirectory detects credentials placed in temporary directory", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-test-"));
      try {
        const fakeGoogleKey = "AIzaSy" + "B".repeat(33);
        fs.writeFileSync(path.join(tmpDir, "leak.js"), `const k = "${fakeGoogleKey}";`);

        const results = scanWorkingDirectory(tmpDir);
        const fileKeys = Object.keys(results);
        assert.equal(fileKeys.length, 1);
        assert.equal(results[fileKeys[0]][0].name, "Google / Gemini API Key");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("detects exposed secrets in a temporary git commit history", () => {
      const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "git-secret-test-"));
      try {
        execSync("git init", { cwd: tmpRepo, stdio: "pipe" });
        execSync("git config user.name 'Test'", { cwd: tmpRepo, stdio: "pipe" });
        execSync("git config user.email 'test@example.com'", { cwd: tmpRepo, stdio: "pipe" });

        const fakeKey = "AIzaSy" + "C".repeat(33);
        fs.writeFileSync(path.join(tmpRepo, "leak.txt"), `apiKey = "${fakeKey}"`);
        execSync("git add leak.txt && git commit -m 'commit with secret'", {
          cwd: tmpRepo,
          stdio: "pipe",
        });

        // Scan commit diff in tmpRepo
        const gitDiff = execSync("git log -p -n 1", { cwd: tmpRepo, encoding: "utf-8" });
        const addedLines = gitDiff
          .split("\n")
          .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
          .join("\n");

        let found = false;
        for (const { regex } of KEY_PATTERNS) {
          regex.lastIndex = 0;
          if (regex.test(addedLines)) {
            found = true;
            break;
          }
        }
        assert.equal(found, true, "Should have detected key pattern in git history");
      } finally {
        fs.rmSync(tmpRepo, { recursive: true, force: true });
      }
    });

    it("checkEnvLocalStatus verifies .env.local is ignored and untracked", () => {
      const issues = checkEnvLocalStatus();
      assert.deepEqual(issues, []);
    });
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPath, scanContent, checkStaged } from "../scripts/check-secrets.js";

test("checkPath: blocks forbidden database and live environment files", () => {
  // Forbidden files
  assert.equal(checkPath(".env").blocked, true);
  assert.equal(checkPath(".env.local").blocked, true);
  assert.equal(checkPath(".env.production").blocked, true);
  assert.equal(checkPath("config/.env.local").blocked, true);
  assert.equal(checkPath("data/app.db").blocked, true);
  assert.equal(checkPath("app.db").blocked, true);
  assert.equal(checkPath("test.sqlite3").blocked, true);

  // Allowed files
  assert.equal(checkPath(".env.example").blocked, false);
  assert.equal(checkPath(".env.local.example").blocked, false);
  assert.equal(checkPath("lib/agents/payment-entity.js").blocked, false);
  assert.equal(checkPath("README.md").blocked, false);
});

test("scanContent: flags Google AIza keys", () => {
  const fakeKey = "AIzaSy" + "D".repeat(33);
  const content = `+const key = "${fakeKey}";`;
  const violations = scanContent(content, { diffMode: true });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "Google / Gemini API Key (AIza...)");
});

test("scanContent: flags OpenAI and Groq keys", () => {
  const openAiKey = "sk-" + "A".repeat(30);
  const groqKey = "gsk_" + "B".repeat(25);

  const content = `
+OPENAI_KEY = "${openAiKey}"
+GROQ_SECRET = "${groqKey}"
`;
  const violations = scanContent(content, { diffMode: true });
  assert.equal(violations.length, 2);
});

test("scanContent: flags private key headers", () => {
  const header = "-----BEGIN " + "PRIVATE KEY-----";
  const content = `
+${header}
+MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...
+-----END PRIVATE KEY-----
`;
  const violations = scanContent(content, { diffMode: true });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "Private Key Header");
});

test("scanContent: flags high-entropy tokens assigned to *_KEY variables", () => {
  const varName = "SERPER_" + "API_KEY";
  const content = `+${varName} = "1234567890abcdef1234567890abcdef"`;
  const violations = scanContent(content, { diffMode: true });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, "Generic Secret / Key Assignment");
});

test("scanContent: allows safe placeholders, dummy values, and comments", () => {
  const cleanContent = `
+// SERPER_API_KEY is read from env
+const token = "your_api_key_here";
+const testKey = "dummy_placeholder_key_12345";
+const mockVal = "mock_secret_test_value";
+const envRef = process.env.API_KEY;
`;
  const violations = scanContent(cleanContent, { diffMode: true });
  assert.equal(violations.length, 0);
});

test("scanContent: diffMode ignores deleted lines and unchanged context", () => {
  const fakeKey = "AIzaSy" + "E".repeat(33);
  const diffContent = `
-const oldKey = "${fakeKey}";
 const unchanged = "hello";
`;
  const violations = scanContent(diffContent, { diffMode: true });
  assert.equal(violations.length, 0);
});

test("checkStaged: reports clean status when mock exec returns clean staged files", () => {
  const mockExec = (cmd) => {
    if (cmd.includes("--name-only")) {
      return "app/page.js\nlib/agents/activity.js\n";
    }
    return "+const cleanCode = true;\n";
  };

  const res = checkStaged({ exec: mockExec });
  assert.equal(res.ok, true);
  assert.equal(res.errors.length, 0);
});

test("checkStaged: reports error when staged files include forbidden path or key", () => {
  const mockExec = (cmd) => {
    if (cmd.includes("--name-only")) {
      return ".env.local\n";
    }
    return "";
  };

  const res = checkStaged({ exec: mockExec });
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].file, ".env.local");
  assert.equal(res.errors[0].rule, "Live Environment File");
});

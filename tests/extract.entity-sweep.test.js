import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { getDb, createCheck, saveInputs, getInputs, getEntities, getEvents } from "../lib/db/index.js";
import { runExtraction, extractEntitiesFromText, EntitySweepSchema } from "../lib/extract.js";
import { runCleanup } from "../lib/cleanup.js";

function createIsolatedDb() {
  const dbPath = `./data/test_entity_sweep_${Date.now()}_${Math.random().toString(36).slice(2)}.db`;
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = getDb(dbPath);
  return {
    db,
    cleanup: () => {
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      } catch {}
    },
  };
}

test("Entity Sweep: captures clues from main text, handle, and userNotes with evidence", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const mainText =
      "Congratulations, you are selected for an internship at Google. Pay Rs 500 to rahul.hr@oksbi, call 9876543210";
    const userNotes =
      "He first messaged me on Telegram as Priya from Google HR and asked me to move to WhatsApp";

    saveInputs(
      checkId,
      [
        { type: "text", value: mainText },
        { type: "handle", value: "@google_hr_careers" },
        { type: "user_notes", value: userNotes },
      ],
      db
    );

    // Mock generate implementing LLM entity sweep with candidate entities from combined text
    const mockGenerate = async (params) => {
      if (params.purpose === "entity_sweep") {
        return {
          ok: true,
          data: {
            companies: [{ name: "Google", quote: "Google" }],
            handles: [],
            amounts: [{ amount: "500", quote: "Rs 500" }],
            paymentIds: [{ id: "rahul.hr@oksbi", quote: "rahul.hr@oksbi" }],
          },
        };
      }
      return { ok: false, error: { code: "UNEXPECTED", message: "unexpected call" } };
    };

    const res = await runExtraction(checkId, {
      db,
      generate: mockGenerate,
      handlePlatform: "instagram",
    });

    assert.equal(res.status, "awaiting_confirmation");

    const entities = getEntities(checkId, db);
    const byKind = (k) => entities.filter((e) => e.kind === k);

    // 1. Company Google
    const companies = byKind("company");
    assert.equal(companies.length, 1, "Expected exactly 1 company entity (deduped across sources)");
    assert.equal(companies[0].value, "Google");
    assert.ok(companies[0].evidence?.value.toLowerCase().includes("google"));

    // 2. UPI ID (rahul.hr@oksbi) - Must NOT be email
    const upis = byKind("upi");
    assert.equal(upis.length, 1, "Expected exactly 1 upi entity");
    assert.equal(upis[0].value, "rahul.hr@oksbi");
    assert.ok(upis[0].evidence?.value.includes("rahul.hr@oksbi"));

    const emails = byKind("email");
    assert.equal(emails.length, 0, "rahul.hr@oksbi must NOT be parsed as an email entity");

    // 3. Phone (+919876543210)
    const phones = byKind("phone");
    assert.equal(phones.length, 1, "Expected exactly 1 phone entity");
    assert.equal(phones[0].value, "+919876543210");
    assert.ok(phones[0].evidence?.value.includes("9876543210"));

    // 4. Amount (500)
    const amounts = byKind("amount");
    assert.equal(amounts.length, 1, "Expected exactly 1 amount entity");
    assert.equal(amounts[0].value, "500");
    assert.ok(amounts[0].evidence?.value.includes("500"));

    // 5. Handle (@google_hr_careers on Instagram)
    const handles = byKind("handle");
    assert.equal(handles.length, 1, "Expected exactly 1 handle entity");
    assert.equal(handles[0].value, "google_hr_careers");
    assert.equal(handles[0].platform, "instagram");
    assert.ok(handles[0].evidence?.value.includes("google_hr_careers"));

    // 6. Notes verification: No handles created from notes (e.g. no Priya, Telegram, WhatsApp)
    assert.ok(!entities.some((e) => e.value.toLowerCase().includes("priya")));
    assert.ok(!entities.some((e) => e.value.toLowerCase().includes("telegram")));
    assert.ok(!entities.some((e) => e.value.toLowerCase().includes("whatsapp")));
  } finally {
    cleanup();
  }
});

test("Grounding check: keeps grounded quote and drops ungrounded hallucination", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const mainText = "Offered internship at Apple. Pay Rs 200 fee.";
    saveInputs(checkId, [{ type: "text", value: mainText }], db);

    const mockGenerate = async (params) => {
      if (params.purpose === "entity_sweep") {
        return {
          ok: true,
          data: {
            companies: [
              // Kept case: present in text with slight case/whitespace
              { name: "Apple", quote: "  apple " },
              // Dropped case: hallucinated company not anywhere in text
              { name: "Microsoft", quote: "Selected at Microsoft" },
            ],
            handles: [],
            amounts: [],
            paymentIds: [],
          },
        };
      }
      return { ok: false };
    };

    await runExtraction(checkId, { db, generate: mockGenerate });

    const entities = getEntities(checkId, db);
    const companies = entities.filter((e) => e.kind === "company");

    assert.equal(companies.length, 1, "Only grounded company must be retained");
    assert.equal(companies[0].value, "Apple");
    assert.ok(!entities.some((e) => e.value.toLowerCase() === "microsoft"), "Hallucinated company must be dropped");
  } finally {
    cleanup();
  }
});

test("Fallback: LLM sweep failure falls back to regex entities and logs event", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const mainText = "Pay Rs 300 to contact@okaxis or call 9123456780";
    saveInputs(checkId, [{ type: "text", value: mainText }], db);

    let retryCount = 0;
    const failingGenerate = async (params) => {
      if (params.purpose === "entity_sweep") {
        retryCount++;
        return { ok: false, error: { code: "SERVICE_ERROR", message: "API failure" } };
      }
      return { ok: false };
    };

    const res = await runExtraction(checkId, { db, generate: failingGenerate });
    assert.equal(res.status, "awaiting_confirmation");
    assert.equal(retryCount, 2, "Expected 1 initial call + 1 retry = 2 calls");

    const entities = getEntities(checkId, db);
    // Regex entities still captured
    assert.ok(entities.some((e) => e.kind === "upi" && e.value === "contact@okaxis"));
    assert.ok(entities.some((e) => e.kind === "amount" && e.value === "300"));
    assert.ok(entities.some((e) => e.kind === "phone" && e.value === "+919123456780"));

    // Event recorded for fallback
    const events = getEvents(checkId, db);
    assert.ok(
      events.some((ev) => ev.summary?.includes("LLM entity sweep unavailable") || ev.summary?.includes("fallback")),
      "Expected fallback event to be recorded"
    );
  } finally {
    cleanup();
  }
});

test("userNotes cleanup: deleted with expired check and never exposed", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    const pastIso = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    createCheck({ id: checkId, language: "en", status: "created" }, db);
    db.prepare(`UPDATE checks SET expires_at = ? WHERE id = ?`).run(pastIso, checkId);

    saveInputs(
      checkId,
      [
        { type: "text", value: "Secret message" },
        { type: "user_notes", value: "Highly sensitive student note" },
      ],
      db
    );

    const beforeInputs = getInputs(checkId, db);
    assert.equal(beforeInputs.length, 2);

    await runCleanup({ db });

    const afterInputs = getInputs(checkId, db);
    assert.equal(afterInputs.length, 0, "All inputs including user_notes must be deleted with check");
  } finally {
    cleanup();
  }
});

test("Phone extraction: normalization of spaced, hyphend, prefixed numbers and false positive rejection", () => {
  const cases = [
    { text: "Contact us at 98 76 54 32 10 for details", expected: "+919876543210" },
    { text: "Reach HR on 98765-43210 today", expected: "+919876543210" },
    { text: "Call +91 98765 43210 immediately", expected: "+919876543210" },
    { text: "Dial 98765 43210 now", expected: "+919876543210" },
  ];

  for (const c of cases) {
    const ents = extractEntitiesFromText(c.text);
    const phones = ents.filter((e) => e.kind === "phone");
    assert.equal(phones.length, 1, `Failed to extract phone from "${c.text}"`);
    assert.equal(phones[0].value, c.expected);
  }

  // False positive test: a 10-digit order number starting with 1 must not be extracted
  const fpText = "Your Amazon order 1987654321 has been shipped. Reference number 1234567890.";
  const fpEnts = extractEntitiesFromText(fpText);
  const fpPhones = fpEnts.filter((e) => e.kind === "phone");
  assert.equal(fpPhones.length, 0, "10-digit order numbers starting with 1 must not be extracted as phone numbers");
});

test("EntitySweepSchema: accepts aliases upiId, upi, and varied keys via z.preprocess", () => {
  const outputWithAliases = {
    companies: [{ company: "Google", evidence: "Google" }],
    handles: [{ username: "google_jobs", channel: "telegram", evidence_quote: "@google_jobs" }],
    amounts: [{ fee: "500", quote: "Rs 500" }],
    paymentIds: [
      { upiId: "rahul.hr@oksbi", quote: "rahul.hr@oksbi" },
      { upi: "payment@okaxis", quote: "payment@okaxis" },
      { paymentId: "admin@paytm", quote: "admin@paytm" },
    ],
  };

  const parsed = EntitySweepSchema.parse(outputWithAliases);
  assert.equal(parsed.companies[0].name, "Google");
  assert.equal(parsed.companies[0].quote, "Google");
  assert.equal(parsed.handles[0].handle, "google_jobs");
  assert.equal(parsed.amounts[0].amount, "500");
  assert.equal(parsed.paymentIds[0].id, "rahul.hr@oksbi");
  assert.equal(parsed.paymentIds[1].id, "payment@okaxis");
  assert.equal(parsed.paymentIds[2].id, "admin@paytm");
});

test("Entity sweep: extracts scheme entity grounded with quote for PM Vidyalaxmi scholarship", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const mainText = "Apply for the PM Vidyalaxmi scholarship scheme for financial support in higher education.";
    saveInputs(checkId, [{ type: "text", value: mainText }], db);

    const mockGenerate = async (params) => {
      if (params.purpose === "entity_sweep") {
        return {
          ok: true,
          data: {
            companies: [],
            schemes: [{ name: "PM Vidyalaxmi scholarship", quote: "PM Vidyalaxmi scholarship" }],
            handles: [],
            amounts: [],
            paymentIds: [],
          },
        };
      }
      return { ok: false };
    };

    const res = await runExtraction(checkId, { db, generate: mockGenerate });
    assert.equal(res.status, "awaiting_confirmation");

    const entities = getEntities(checkId, db);
    const schemes = entities.filter((e) => e.kind === "scheme");
    assert.equal(schemes.length, 1, "Expected PM Vidyalaxmi scholarship to be extracted as a scheme");
    assert.equal(schemes[0].value, "PM Vidyalaxmi scholarship");
    assert.equal(schemes[0].source, "extracted");
    assert.equal(schemes[0].evidence?.value, "PM Vidyalaxmi scholarship");
  } finally {
    cleanup();
  }
});

test("Known-organisation fallback: extracts Google when sweep fails with Case 1 input", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const mainText =
      "Congratulations, you are selected for an internship at Google. Pay Rs 500 to rahul.hr@oksbi, call 9876543210";
    const userNotes =
      "He first messaged me on Telegram as Priya from Google HR and asked me to move to WhatsApp";

    saveInputs(
      checkId,
      [
        { type: "text", value: mainText },
        { type: "handle", value: "@google_hr_careers" },
        { type: "user_notes", value: userNotes },
      ],
      db
    );

    // Mock failing generate to simulate LLM entity sweep failure
    const failingGenerate = async (params) => {
      if (params.purpose === "entity_sweep") {
        return { ok: false, error: { code: "SERVICE_ERROR", message: "API offline" } };
      }
      return { ok: false };
    };

    const res = await runExtraction(checkId, { db, generate: failingGenerate });
    assert.equal(res.status, "awaiting_confirmation");

    const entities = getEntities(checkId, db);
    const companies = entities.filter((e) => e.kind === "company");
    assert.equal(companies.length, 1, "Expected Google to be extracted through fallback");
    assert.equal(companies[0].value, "Google");
    assert.equal(companies[0].source, "extracted");
    assert.ok(companies[0].evidence?.value.toLowerCase().includes("google"));
  } finally {
    cleanup();
  }
});

test("Known-organisation fallback: asserts no company is invented when text has none", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const mainText = "Pay Rs 500 to rahul.hr@oksbi for registration, call 9876543210";
    saveInputs(checkId, [{ type: "text", value: mainText }], db);

    const failingGenerate = async (params) => {
      return { ok: false, error: { code: "SERVICE_ERROR", message: "API failure" } };
    };

    await runExtraction(checkId, { db, generate: failingGenerate });

    const entities = getEntities(checkId, db);
    const companies = entities.filter((e) => e.kind === "company");
    assert.equal(companies.length, 0, "No company entity must be invented when text contains no known organisations");
  } finally {
    cleanup();
  }
});

test("Entity sweep: retries exactly once with validation error appended", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const mainText = "Internship at Google. Pay Rs 500 to rahul.hr@oksbi";
    saveInputs(checkId, [{ type: "text", value: mainText }], db);

    const promptsReceived = [];
    const mockGenerate = async (params) => {
      if (params.purpose === "entity_sweep") {
        promptsReceived.push(params.prompt);
        if (promptsReceived.length === 1) {
          return { ok: false, error: { code: "PARSE_ERROR", message: "paymentIds.0.id: Required" } };
        }
        return {
          ok: true,
          data: {
            companies: [{ name: "Google", quote: "Google" }],
            handles: [],
            amounts: [{ amount: "500", quote: "Rs 500" }],
            paymentIds: [{ id: "rahul.hr@oksbi", quote: "rahul.hr@oksbi" }],
          },
        };
      }
      return { ok: false };
    };

    await runExtraction(checkId, { db, generate: mockGenerate });
    assert.equal(promptsReceived.length, 2, "Expected exactly one initial call + one retry");
    assert.ok(
      promptsReceived[1].includes("paymentIds.0.id: Required") ||
        promptsReceived[1].includes("ATTENTION") ||
        promptsReceived[1].includes("failed"),
      "Second prompt must have validation error appended"
    );
  } finally {
    cleanup();
  }
});

test("API GET /api/checks/:id surfaces extractionNotes when fallback occurs", async () => {
  const { db, cleanup } = createIsolatedDb();
  try {
    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, language: "en", status: "created" }, db);
    saveInputs(checkId, [{ type: "text", value: "Internship at Google. Pay Rs 500 to rahul.hr@oksbi" }], db);

    const failingGenerate = async () => ({ ok: false, error: { code: "SERVICE_ERROR", message: "API offline" } });
    await runExtraction(checkId, { db, generate: failingGenerate });

    const req = new Request(`http://localhost/api/checks/${checkId}`);
    const mockRuntime = {
      db,
      rateLimiters: { getCheck: { assertAllowed: () => {} } },
    };
    const { GET: getCheckHandler } = await import("../app/api/checks/[id]/route.js");
    const res = await getCheckHandler(req, { runtime: mockRuntime, params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.extractionNotes, "Expected extractionNotes to be populated in API response");
    assert.ok(body.extractionNotes.includes("entity sweep unavailable") || body.extractionNotes.includes("incomplete"));
  } finally {
    cleanup();
  }
});



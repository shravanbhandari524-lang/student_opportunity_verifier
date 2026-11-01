import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getDb,
  createCheck,
  updateStatus,
  saveInputs,
  getInputs,
  clearInputFile,
  replaceTextInputs,
  addEntities,
  getEntities,
  saveConfirmation,
  InvalidStateTransitionError,
  saveRoundResults,
  saveAgentResult,
  DuplicateAgentResultError,
  getAgentResults,
  getEvents,
} from "../lib/db/index.js";

const TEST_DB = "./data/test_db_repository_x.db";

function setupTestDb() {
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  return getDb(TEST_DB);
}

test("db-repository: addEntities keeps confirmed entities and ignores duplicates", () => {
  const db = setupTestDb();
  const check = createCheck({ language: "en" }, db);

  // 1. Insert initial entity with confirmed = true
  const initial = addEntities(
    check.id,
    [
      {
        kind: "domain",
        value: "example.com",
        source: "user",
        round: 0,
        confirmed: true,
      },
    ],
    db
  );
  assert.equal(initial.addedCount, 1);

  // Verify entity in DB
  const firstList = getEntities(check.id, db);
  assert.equal(firstList.length, 1);
  assert.equal(firstList[0].kind, "domain");
  assert.equal(firstList[0].value, "example.com");
  assert.equal(firstList[0].confirmed, true);

  // 2. Add duplicate entity (same check_id, kind, value) but different confirmed/source
  const duplicate = addEntities(
    check.id,
    [
      {
        kind: "domain",
        value: "example.com",
        source: "extracted",
        round: 0,
        confirmed: false,
      },
      {
        kind: "upi",
        value: "user@okaxis",
        source: "extracted",
        round: 0,
        confirmed: false,
      },
    ],
    db
  );

  // Only the UPI entity should be added; duplicate domain should be ignored
  assert.equal(duplicate.addedCount, 1);

  const updatedList = getEntities(check.id, db);
  assert.equal(updatedList.length, 2);

  const domainEnt = updatedList.find((e) => e.kind === "domain");
  assert.ok(domainEnt);
  assert.equal(domainEnt.value, "example.com");
  assert.equal(domainEnt.source, "user");
  assert.equal(domainEnt.confirmed, true, "Existing confirmed status must be preserved");

  const upiEnt = updatedList.find((e) => e.kind === "upi");
  assert.ok(upiEnt);
  assert.equal(upiEnt.value, "user@okaxis");
});

test("db-repository: clearInputFile affects one input only", () => {
  const db = setupTestDb();
  const check = createCheck({ language: "en" }, db);

  const saved = saveInputs(
    check.id,
    [
      {
        type: "image",
        filePath: "/uploads/image1.png",
        mimeType: "image/png",
        sizeBytes: 1024,
      },
      {
        type: "image",
        filePath: "/uploads/image2.png",
        mimeType: "image/png",
        sizeBytes: 2048,
      },
    ],
    db
  );

  assert.equal(saved.length, 2);
  const [first, second] = saved;

  assert.equal(first.filePath, "/uploads/image1.png");
  assert.equal(second.filePath, "/uploads/image2.png");

  // Clear first input file only
  const res = clearInputFile(first.id, db);
  assert.equal(res.cleared, true);

  const after = getInputs(check.id, db);
  assert.equal(after.length, 2);

  const updatedFirst = after.find((i) => i.id === first.id);
  const updatedSecond = after.find((i) => i.id === second.id);

  assert.equal(updatedFirst.filePath, null);
  assert.equal(updatedSecond.filePath, "/uploads/image2.png", "Second input file path must remain intact");

  // Clearing non-existent id
  const missingRes = clearInputFile(999999, db);
  assert.equal(missingRes.cleared, false);
});

test("db-repository: replaceTextInputs leaves image and url inputs alone", () => {
  const db = setupTestDb();
  const check = createCheck({ language: "en" }, db);

  // Setup inputs: 1 text, 1 url, 1 image
  saveInputs(
    check.id,
    [
      { type: "text", value: "Initial user message" },
      { type: "url", value: "https://opportunity.example.org" },
      { type: "image", filePath: "/uploads/img.png", mimeType: "image/png", sizeBytes: 500 },
    ],
    db
  );

  const initialInputs = getInputs(check.id, db);
  assert.equal(initialInputs.length, 3);

  // Replace text inputs with 2 new text snippets
  const updated = replaceTextInputs(check.id, ["Updated text part 1", "OCR transcribed text part 2"], db);
  assert.equal(updated.length, 4); // 2 texts + 1 url + 1 image

  const texts = updated.filter((i) => i.type === "text").map((i) => i.value);
  assert.deepEqual(texts, ["Updated text part 1", "OCR transcribed text part 2"]);

  const urlInput = updated.find((i) => i.type === "url");
  assert.ok(urlInput);
  assert.equal(urlInput.value, "https://opportunity.example.org");

  const imgInput = updated.find((i) => i.type === "image");
  assert.ok(imgInput);
  assert.equal(imgInput.filePath, "/uploads/img.png");
});

test("db-repository: saveConfirmation works only in awaiting_confirmation and is atomic", () => {
  const db = setupTestDb();
  const check = createCheck({ language: "en" }, db);

  saveInputs(
    check.id,
    [
      { type: "text", value: "Original text" },
      { type: "url", value: "https://portal.gov.in" },
    ],
    db
  );

  addEntities(
    check.id,
    [
      {
        kind: "domain",
        value: "portal.gov.in",
        source: "extracted",
        round: 0,
        confirmed: false,
      },
    ],
    db
  );

  // 1. Should fail when status is 'created' (not 'awaiting_confirmation')
  assert.throws(
    () => {
      saveConfirmation(
        check.id,
        {
          texts: ["Confirmed text"],
          entities: [{ kind: "domain", value: "portal.gov.in" }],
        },
        db
      );
    },
    (err) => err instanceof InvalidStateTransitionError || err.code === "INVALID_STATE_TRANSITION"
  );

  // Transition to extracting, then awaiting_confirmation
  updateStatus(check.id, "extracting", db);
  updateStatus(check.id, "awaiting_confirmation", db);

  // 2. Successful confirmation in awaiting_confirmation
  const confirmResult = saveConfirmation(
    check.id,
    {
      texts: ["Confirmed message text"],
      entities: [
        {
          kind: "domain",
          value: "portal.gov.in",
          source: "extracted",
          round: 0,
        },
        {
          kind: "upi",
          value: "scholarship@sbi",
          source: "user",
          round: 0,
        },
      ],
    },
    db
  );

  assert.equal(confirmResult.textsCount, 1);
  assert.equal(confirmResult.entitiesCount, 2);

  const confirmedEntities = getEntities(check.id, db);
  assert.equal(confirmedEntities.length, 2);
  for (const ent of confirmedEntities) {
    assert.equal(ent.confirmed, true, "All confirmed entities must have confirmed = true");
  }

  // 3. Atomicity: force a validation error in entities list and assert rollback
  assert.throws(
    () => {
      saveConfirmation(
        check.id,
        {
          texts: ["Brand new text that should roll back"],
          entities: [
            { kind: "domain", value: "valid.com" },
            { kind: "domain", value: "invalid domain with spaces" }, // Fails EntitySchema
          ],
        },
        db
      );
    },
    (err) => err.name === "ZodError"
  );

  // Assert nothing changed after failed attempt
  const inputsAfterRollback = getInputs(check.id, db);
  const textInput = inputsAfterRollback.find((i) => i.type === "text");
  assert.equal(textInput.value, "Confirmed message text", "Text inputs must remain untouched after rollback");

  const entitiesAfterRollback = getEntities(check.id, db);
  assert.equal(entitiesAfterRollback.length, 2, "Entities must remain untouched after rollback");
  assert.ok(entitiesAfterRollback.some((e) => e.value === "portal.gov.in"));
});

test("db-repository: saveRoundResults is atomic and rejects a duplicate (check, agent, round)", () => {
  const db = setupTestDb();
  const check = createCheck({ language: "en" }, db);
  updateStatus(check.id, "extracting", db);
  updateStatus(check.id, "awaiting_confirmation", db);
  updateStatus(check.id, "investigating", db);

  const agentResult1 = {
    agent: "website_forensics",
    kind: "agent",
    round: 1,
    status: "ok",
    reason: null,
    flags: [],
    verified: ["Valid SSL certificate"],
    newEntities: [
      {
        kind: "domain",
        value: "linked-target.com",
        evidence: { type: "url", value: "https://inspected-site.org" },
      },
    ],
    processedEntities: ["domain:inspected-site.org"],
    unchecked: [],
    manualChecks: [],
    trace: [],
    notes: "Forensics complete",
    durationMs: 45,
  };

  const roundRes = saveRoundResults(
    check.id,
    {
      result: agentResult1,
      newEntities: [
        {
          kind: "domain",
          value: "linked-target.com",
          source: "discovered",
          discoveredBy: "website_forensics",
          round: 1,
          confirmed: false,
          evidence: { type: "url", value: "https://inspected-site.org" },
        },
      ],
      events: [
        {
          type: "agent",
          agent: "website_forensics",
          status: "completed",
          summary: "Forensics finished",
        },
      ],
    },
    db
  );

  assert.ok(roundRes.result);
  assert.equal(roundRes.result.agent, "website_forensics");
  assert.equal(roundRes.addedEntitiesCount, 1);
  assert.equal(roundRes.eventsCount, 1);

  // Verify entities & events stored
  const ents = getEntities(check.id, db);
  assert.equal(ents.length, 1);
  assert.equal(ents[0].value, "linked-target.com");
  assert.equal(ents[0].source, "discovered");

  const events = getEvents(check.id, db);
  assert.equal(events.length, 1);
  assert.equal(events[0].agent, "website_forensics");

  // 2. Reject duplicate (check_id, agent, round) with DuplicateAgentResultError
  assert.throws(
    () => {
      saveRoundResults(
        check.id,
        {
          result: agentResult1,
          newEntities: [
            {
              kind: "domain",
              value: "another-domain.com",
              source: "discovered",
              discoveredBy: "website_forensics",
              round: 1,
              confirmed: false,
              evidence: { type: "url", value: "https://site.org" },
            },
          ],
          events: [{ type: "agent", agent: "website_forensics", status: "completed" }],
        },
        db
      );
    },
    (err) => err instanceof DuplicateAgentResultError || err.code === "DUPLICATE_AGENT_RESULT"
  );

  // Assert atomicity: newEntities and events from the duplicate attempt must not be persisted
  const entsAfterDup = getEntities(check.id, db);
  assert.equal(entsAfterDup.length, 1, "Discovered entities must not be inserted on duplicate error");
  assert.equal(entsAfterDup[0].value, "linked-target.com");

  const eventsAfterDup = getEvents(check.id, db);
  assert.equal(eventsAfterDup.length, 1, "Events must not be appended on duplicate error");
});

test("db-repository: all repository functions reject invalid data via contracts", () => {
  const db = setupTestDb();
  const check = createCheck({ language: "en" }, db);

  // 1. addEntities rejects invalid entity kind
  assert.throws(
    () => {
      addEntities(check.id, [{ kind: "unsupported_kind", value: "foo", source: "user", confirmed: false }], db);
    },
    (err) => err.name === "ZodError"
  );

  // 2. clearInputFile rejects invalid inputId
  assert.throws(() => clearInputFile("not-a-number", db), /expected positive integer/);
  assert.throws(() => clearInputFile(-5, db), /expected positive integer/);

  // 3. replaceTextInputs rejects non-array
  assert.throws(() => replaceTextInputs(check.id, "string-not-array", db), /texts must be an array/);

  // 4. saveRoundResults rejects invalid result object
  assert.throws(
    () => {
      saveRoundResults(check.id, { result: { agent: "unknown_agent", round: 1 } }, db);
    },
    (err) => err.name === "ZodError"
  );
});

test("db-repository: entities persist and retrieve orgType correctly", () => {
  const db = setupTestDb();
  const check = createCheck({ language: "en" }, db);

  addEntities(
    check.id,
    [
      {
        kind: "company",
        value: "Department of Higher Education",
        orgType: "government",
        source: "extracted",
        round: 0,
        confirmed: true,
      },
    ],
    db
  );

  const ents = getEntities(check.id, db);
  assert.equal(ents.length, 1);
  assert.equal(ents[0].kind, "company");
  assert.equal(ents[0].value, "Department of Higher Education");
  assert.equal(ents[0].orgType, "government");
});

test("db-repository: entities persist purpose and agent_results persist entityStatus correctly", () => {
  const db = setupTestDb();
  const check = createCheck({ language: "en" }, db);

  // 1. Add amount entity with purpose
  addEntities(
    check.id,
    [
      {
        kind: "amount",
        value: "799",
        purpose: "refundable deposit",
        source: "extracted",
        round: 0,
        confirmed: true,
      },
    ],
    db
  );

  const ents = getEntities(check.id, db);
  assert.equal(ents.length, 1);
  assert.equal(ents[0].kind, "amount");
  assert.equal(ents[0].value, "799");
  assert.equal(ents[0].purpose, "refundable deposit");

  // 2. Save agent result with entityStatus
  const savedResult = saveAgentResult(
    check.id,
    {
      checkId: check.id,
      agent: "official_verifier",
      round: 1,
      kind: "check",
      status: "ok",
      summary: "Verified 1 entity",
      activity: [],
      entityStatus: [
        {
          entityKind: "amount",
          entityValue: "799",
          status: "checked_no_issue",
          reason: "fee purpose analyzed",
        },
      ],
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: ["amount:799"],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "",
      durationMs: 42,
    },
    db
  );

  assert.equal(savedResult.entityStatus.length, 1);
  assert.equal(savedResult.entityStatus[0].entityKind, "amount");
  assert.equal(savedResult.entityStatus[0].entityValue, "799");
  assert.equal(savedResult.entityStatus[0].status, "checked_no_issue");
  assert.equal(savedResult.entityStatus[0].reason, "fee purpose analyzed");
});


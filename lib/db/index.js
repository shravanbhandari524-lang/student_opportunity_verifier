import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations/index.js";
import { assertTransition } from "./state-machine.js";
import { CheckSchema, CheckWriteSchema } from "../contracts/check.js";
import { CheckInputRowSchema } from "../contracts/submission.js";
import { EntitySchema } from "../contracts/entity.js";
import { AgentResultSchema } from "../contracts/agent-result.js";
import { CheckEventRowSchema } from "../contracts/events.js";
import { TraceEventSchema, truncateEventPayload } from "../contracts/trace.js";
import { ReportSchema } from "../contracts/report.js";
import { FeedbackSchema } from "../contracts/feedback.js";
import { GraphNodeSchema, GraphEdgeSchema } from "../contracts/graph.js";
import { FAILURE_REASON_CODES } from "../contracts/enums.js";
import { CrawlResultSchema } from "../contracts/crawl.js";
import { purge } from "../cache.js";

export { CHECK_STATUSES, ALLOWED_TRANSITIONS, canTransition, assertTransition } from "./state-machine.js";

const GLOBAL_DB_KEY = Symbol.for("OPP_VERIFIER_DB_INSTANCE");
let dbInstance = null;

/**
 * Returns the SQLite database instance, creating directories and running migrations if needed.
 * Sets journal_mode = WAL, foreign_keys = ON, and busy_timeout = 5000ms.
 * Survives Next.js development server hot-module reloads via globalThis.
 * @param {string} [customPath]
 * @returns {Database.Database}
 */
export function getDb(customPath) {
  if (!customPath && !process.env.NODE_TEST_CONTEXT) {
    if (globalThis[GLOBAL_DB_KEY]) {
      return globalThis[GLOBAL_DB_KEY];
    }
    if (dbInstance) {
      return dbInstance;
    }
  }

  const rawPath = customPath || process.env.DB_PATH || "./data/app.db";
  const dbPath = rawPath === ":memory:" ? ":memory:" : path.resolve(process.cwd(), rawPath);
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  runMigrations(db);

  if (!customPath) {
    dbInstance = db;
    if (!process.env.NODE_TEST_CONTEXT) {
      globalThis[GLOBAL_DB_KEY] = db;
    }
  }
  return db;
}

// -------------------------------------------------------------
// CHECK REPOSITORY
// -------------------------------------------------------------

/**
 * Creates a new check record with expires_at set to 24 hours after creation.
 * Validates check data via CheckSchema.
 *
 * @param {object} params
 * @param {string} [params.id] - Optional UUID, auto-generated if omitted
 * @param {string} [params.language='en']
 * @param {string} [params.status='created']
 * @param {Database.Database} [db]
 * @returns {object} CamelCased check object validated by CheckSchema
 */
export function createCheck({ id, language = "en", status = "created" } = {}, db = getDb()) {
  const checkId = id || crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const validated = CheckSchema.parse({
    id: checkId,
    status,
    currentRound: 0,
    language,
    createdAt,
    updatedAt: createdAt,
    expiresAt,
  });

  const stmt = db.prepare(`
    INSERT INTO checks (id, status, current_round, language, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    validated.id,
    validated.status,
    validated.currentRound,
    validated.language,
    validated.createdAt,
    validated.updatedAt,
    validated.expiresAt
  );

  return getCheck(validated.id, db);
}

/**
 * Gets a check by ID. Returns camelCased object validated by CheckSchema, or null.
 *
 * @param {string} id
 * @param {Database.Database} [db]
 * @returns {object | null}
 */
export function getCheck(id, db = getDb()) {
  const stmt = db.prepare(`SELECT * FROM checks WHERE id = ?`);
  const row = stmt.get(id);
  if (!row) return null;

  return CheckSchema.parse({
    id: row.id,
    status: row.status,
    currentRound: row.current_round,
    language: row.language,
    riskLevel: row.risk_level,
    score: row.score,
    confidence: row.confidence,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  });
}

/**
 * Updates a check's status, enforcing the state machine transitions.
 *
 * @param {string} id
 * @param {string} nextStatus
 * @param {Database.Database} [db]
 * @returns {object} Updated check
 */
export function updateStatus(id, nextStatus, db = getDb()) {
  const check = getCheck(id, db);
  if (!check) {
    throw new Error(`Check not found: ${id}`);
  }

  assertTransition(check.status, nextStatus);

  const updatedAt = new Date().toISOString();
  const stmt = db.prepare(`UPDATE checks SET status = ?, updated_at = ? WHERE id = ? AND status = ?`);
  const info = stmt.run(nextStatus, updatedAt, id, check.status);
  if (info.changes !== 1) {
    const current = getCheck(id, db);
    throw new InvalidStateTransitionError(
      `Atomic transition failed: check '${id}' status modified concurrently (expected '${check.status}' -> '${nextStatus}', found '${current?.status}')`,
      id,
      current?.status || check.status,
      nextStatus
    );
  }

  return getCheck(id, db);
}

/**
 * Atomically transitions check status using a single conditional UPDATE and a row-count check.
 * Rejects transition if current status in DB does not match expectedFromStatus or if transition is invalid.
 *
 * @param {string} id Check ID
 * @param {string} expectedFromStatus Expected current status
 * @param {string} nextStatus Target status
 * @param {Database.Database} [db]
 * @returns {object} Updated check row
 */
export function transitionStatus(id, expectedFromStatus, nextStatus, db = getDb()) {
  assertTransition(expectedFromStatus, nextStatus);

  const updatedAt = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE checks
    SET status = ?, updated_at = ?
    WHERE id = ? AND status = ?
  `);
  const info = stmt.run(nextStatus, updatedAt, id, expectedFromStatus);
  if (info.changes !== 1) {
    const current = getCheck(id, db);
    throw new InvalidStateTransitionError(
      `Atomic transition failed: check '${id}' expected status '${expectedFromStatus}' but found '${current?.status}'`,
      id,
      current?.status || expectedFromStatus,
      nextStatus
    );
  }
  return getCheck(id, db);
}

/**
 * Updates check results: riskLevel, score, confidence, failureReason, currentRound, status.
 *
 * @param {string} id
 * @param {object} updates
 * @param {Database.Database} [db]
 * @returns {object} Updated check
 */
export function updateCheckResult(id, updates = {}, db = getDb()) {
  const current = getCheck(id, db);
  if (!current) {
    throw new Error(`Check not found: ${id}`);
  }

  const nextStatus = updates.status !== undefined ? updates.status : current.status;
  if (nextStatus !== current.status) {
    assertTransition(current.status, nextStatus);
  }

  const updatedAt = new Date().toISOString();
  const candidate = {
    ...current,
    ...updates,
    status: nextStatus,
    updatedAt,
  };

  const validated = CheckWriteSchema.parse(candidate);

  const stmt = db.prepare(`
    UPDATE checks
    SET status = ?, current_round = ?, language = ?, risk_level = ?, score = ?, confidence = ?, failure_reason = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    validated.status,
    validated.currentRound,
    validated.language,
    validated.riskLevel ?? null,
    validated.score ?? null,
    validated.confidence ?? null,
    validated.failureReason ?? null,
    validated.updatedAt,
    id
  );

  return getCheck(id, db);
}

// -------------------------------------------------------------
// CHECK INPUTS REPOSITORY
// -------------------------------------------------------------

/**
 * Saves input rows for a check inside an atomic transaction.
 *
 * @param {string} checkId
 * @param {Array<object>} inputs
 * @param {Database.Database} [db]
 * @returns {Array<object>} Saved inputs
 */
export function saveInputs(checkId, inputs, db = getDb()) {
  const now = new Date().toISOString();
  const validatedInputs = inputs.map((input) =>
    CheckInputRowSchema.parse({
      checkId,
      createdAt: input.createdAt || now,
      ...input,
    })
  );

  const insert = db.prepare(`
    INSERT INTO check_inputs (check_id, type, value, file_path, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(
        row.checkId,
        row.type,
        row.value ?? null,
        row.filePath ?? null,
        row.mimeType ?? null,
        row.sizeBytes ?? null,
        row.createdAt
      );
    }
  });

  tx(validatedInputs);
  return getInputs(checkId, db);
}

/**
 * Gets all input rows for a check.
 *
 * @param {string} checkId
 * @param {Database.Database} [db]
 * @returns {Array<object>}
 */
export function getInputs(checkId, db = getDb()) {
  const stmt = db.prepare(`SELECT * FROM check_inputs WHERE check_id = ? ORDER BY id ASC`);
  const rows = stmt.all(checkId);

  return rows.map((row) =>
    CheckInputRowSchema.parse({
      id: row.id,
      checkId: row.check_id,
      type: row.type,
      value: row.value,
      filePath: row.file_path,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    })
  );
}

/**
 * Sets file_path to NULL for a single check_inputs row by primary key id.
 *
 * @param {number} inputId - Primary key id of the check_inputs row
 * @param {Database.Database} [db]
 * @returns {{ cleared: boolean }}
 */
export function clearInputFile(inputId, db = getDb()) {
  if (typeof inputId !== "number" || !Number.isInteger(inputId) || inputId <= 0) {
    throw new Error(`Invalid inputId: '${inputId}' (expected positive integer)`);
  }

  const stmt = db.prepare(`UPDATE check_inputs SET file_path = NULL WHERE id = ?`);
  const info = stmt.run(inputId);
  return { cleared: info.changes > 0 };
}

/**
 * Replaces all text inputs for a check with the given texts in an atomic transaction.
 * Leaves all other input types (image, url, upi, etc.) untouched.
 *
 * @param {string} checkId - UUID of the check
 * @param {string[]} texts - Array of text strings
 * @param {Database.Database} [db]
 * @returns {Array<object>} All current inputs for the check
 */
export function replaceTextInputs(checkId, texts, db = getDb()) {
  if (!Array.isArray(texts)) {
    throw new Error("texts must be an array of strings");
  }

  const now = new Date().toISOString();
  const validatedRows = texts.map((t) =>
    CheckInputRowSchema.parse({
      checkId,
      type: "text",
      value: t,
      createdAt: now,
    })
  );

  const deleteStmt = db.prepare(`DELETE FROM check_inputs WHERE check_id = ? AND type = 'text'`);
  const insertStmt = db.prepare(`
    INSERT INTO check_inputs (check_id, type, value, file_path, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    deleteStmt.run(checkId);
    for (const row of rows) {
      insertStmt.run(
        row.checkId,
        row.type,
        row.value ?? null,
        row.filePath ?? null,
        row.mimeType ?? null,
        row.sizeBytes ?? null,
        row.createdAt
      );
    }
  });

  tx(validatedRows);
  return getInputs(checkId, db);
}

// -------------------------------------------------------------
// ENTITIES REPOSITORY
// -------------------------------------------------------------

/**
 * Atomically replaces entities for a check (or inserts if none exist).
 *
 * @param {string} checkId
 * @param {Array<object>} entities
 * @param {Database.Database} [db]
 * @returns {Array<object>}
 */
export function replaceEntities(checkId, entities, db = getDb()) {
  const validated = entities.map((entity) =>
    EntitySchema.parse({
      checkId,
      ...entity,
    })
  );

  const deleteStmt = db.prepare(`DELETE FROM entities WHERE check_id = ?`);
  const insertStmt = db.prepare(`
    INSERT INTO entities (check_id, kind, value, source, platform, org_type, purpose, direction, discovered_by, round, confirmed, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    deleteStmt.run(checkId);
    for (const row of rows) {
      insertStmt.run(
        row.checkId,
        row.kind,
        row.value,
        row.source,
        row.platform ?? null,
        row.orgType ?? null,
        row.purpose ?? null,
        row.direction ?? null,
        row.discoveredBy ?? null,
        row.round,
        row.confirmed ? 1 : 0,
        row.evidence ? JSON.stringify(row.evidence) : null
      );
    }
  });

  tx(validated);
  return getEntities(checkId, db);
}

/**
 * Gets all entities for a check, parsing evidence_json and converting confirmed integer to boolean.
 *
 * @param {string} checkId
 * @param {Database.Database} [db]
 * @returns {Array<object>}
 */
export function getEntities(checkId, db = getDb()) {
  const stmt = db.prepare(`SELECT * FROM entities WHERE check_id = ? ORDER BY id ASC`);
  const rows = stmt.all(checkId);

  return rows.map((row) => {
    let evidence = null;
    if (row.evidence_json) {
      try {
        evidence = JSON.parse(row.evidence_json);
      } catch {
        evidence = null;
      }
    }

    return EntitySchema.parse({
      id: row.id,
      checkId: row.check_id,
      kind: row.kind,
      value: row.value,
      source: row.source,
      platform: row.platform ?? null,
      orgType: row.org_type ?? null,
      purpose: row.purpose ?? null,
      direction: row.direction ?? null,
      discoveredBy: row.discovered_by,
      round: row.round,
      confirmed: Boolean(row.confirmed),
      evidence,
    });
  });
}

/**
 * Inserts entities, ignoring rows that violate UNIQUE(check_id, kind, value).
 * Never deletes or modifies existing rows; returns the count added.
 *
 * @param {string} checkId
 * @param {Array<object>} entities
 * @param {Database.Database} [db]
 * @returns {{ addedCount: number }}
 */
export function addEntities(checkId, entities, db = getDb()) {
  if (!Array.isArray(entities)) {
    throw new Error("entities must be an array");
  }

  const validated = entities.map((entity) =>
    EntitySchema.parse({
      checkId,
      ...entity,
    })
  );

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO entities (check_id, kind, value, source, platform, org_type, purpose, direction, discovered_by, round, confirmed, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount = 0;
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      const info = insertStmt.run(
        row.checkId,
        row.kind,
        row.value,
        row.source,
        row.platform ?? null,
        row.orgType ?? null,
        row.purpose ?? null,
        row.direction ?? null,
        row.discoveredBy ?? null,
        row.round,
        row.confirmed ? 1 : 0,
        row.evidence ? JSON.stringify(row.evidence) : null
      );
      if (info.changes > 0) {
        addedCount++;
      }
    }
  });

  tx(validated);
  return { addedCount };
}

export class InvalidStateTransitionError extends Error {
  constructor(message, checkId, fromStatus, toStatus) {
    super(message);
    this.name = "InvalidStateTransitionError";
    this.code = "INVALID_STATE_TRANSITION";
    this.checkId = checkId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

/**
 * Atomically replaces text inputs and entities for a check, setting confirmed = 1.
 * Preserves source if already set; user-added entities default to source "user".
 * Allowed strictly when checks.status is 'awaiting_confirmation'.
 *
 * @param {string} checkId
 * @param {object} params
 * @param {string[]} [params.texts=[]]
 * @param {Array<object>} [params.entities=[]]
 * @param {Database.Database} [db]
 * @returns {{ textsCount: number, entitiesCount: number }}
 */
export function saveConfirmation(checkId, { texts = [], entities = [] } = {}, db = getDb()) {
  const check = getCheck(checkId, db);
  if (!check) {
    throw new Error(`Check not found: ${checkId}`);
  }

  if (check.status !== "awaiting_confirmation") {
    throw new InvalidStateTransitionError(
      `saveConfirmation is allowed only when status is 'awaiting_confirmation' (current status: '${check.status}')`,
      checkId,
      check.status,
      "investigating"
    );
  }

  const now = new Date().toISOString();

  // If texts is provided and non-empty, validate new texts.
  // If texts is omitted or empty, preserve existing text inputs in check_inputs.
  const shouldUpdateTexts = Array.isArray(texts) && texts.length > 0;
  const validatedTexts = shouldUpdateTexts
    ? texts.map((t) =>
        CheckInputRowSchema.parse({
          checkId,
          type: "text",
          value: t,
          createdAt: now,
        })
      )
    : [];

  // Index existing entities by kind:value to preserve extracted metadata (platform, orgType, purpose, evidence)
  const existingEntities = getEntities(checkId, db);
  const existingByKey = new Map();
  for (const ent of existingEntities) {
    const k = `${ent.kind}:${ent.value}`;
    existingByKey.set(k, ent);
  }

  // Validate entities as Entity candidates with confirmed = true, inheriting extracted metadata if missing
  const validatedEntities = entities.map((ent) => {
    const k = `${ent.kind}:${ent.value}`;
    const prev = existingByKey.get(k);
    return EntitySchema.parse({
      checkId,
      source: ent.source || prev?.source || "user",
      round: ent.round ?? prev?.round ?? 0,
      platform: ent.platform ?? prev?.platform ?? null,
      orgType: ent.orgType ?? prev?.orgType ?? null,
      purpose: ent.purpose ?? prev?.purpose ?? null,
      direction: ent.direction ?? prev?.direction ?? null,
      evidence: ent.evidence ?? prev?.evidence ?? null,
      ...ent,
      confirmed: true,
    });
  });

  const deleteTextsStmt = db.prepare(`DELETE FROM check_inputs WHERE check_id = ? AND type = 'text'`);
  const insertTextStmt = db.prepare(`
    INSERT INTO check_inputs (check_id, type, value, file_path, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteEntitiesStmt = db.prepare(`DELETE FROM entities WHERE check_id = ?`);
  const insertEntityStmt = db.prepare(`
    INSERT INTO entities (check_id, kind, value, source, platform, org_type, purpose, direction, discovered_by, round, confirmed, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    if (shouldUpdateTexts) {
      deleteTextsStmt.run(checkId);
      for (const t of validatedTexts) {
        insertTextStmt.run(
          t.checkId,
          t.type,
          t.value ?? null,
          t.filePath ?? null,
          t.mimeType ?? null,
          t.sizeBytes ?? null,
          t.createdAt
        );
      }
    }

    deleteEntitiesStmt.run(checkId);
    for (const e of validatedEntities) {
      insertEntityStmt.run(
        e.checkId,
        e.kind,
        e.value,
        e.source,
        e.platform ?? null,
        e.orgType ?? null,
        e.purpose ?? null,
        e.direction ?? null,
        e.discoveredBy ?? null,
        e.round,
        1,
        e.evidence ? JSON.stringify(e.evidence) : null
      );
    }
  });

  tx();

  return {
    textsCount: validatedTexts.length,
    entitiesCount: validatedEntities.length,
  };
}

// -------------------------------------------------------------
// AGENT RESULTS REPOSITORY
// -------------------------------------------------------------

export class DuplicateAgentResultError extends Error {
  constructor(checkId, agent, round) {
    super(`Duplicate agent result for check '${checkId}', agent '${agent}', round ${round}`);
    this.name = "DuplicateAgentResultError";
    this.code = "DUPLICATE_AGENT_RESULT";
    this.checkId = checkId;
    this.agent = agent;
    this.round = round;
  }
}

/**
 * Saves an agent result for a check and round.
 * Rejects duplicate results for the same (check_id, agent, round) with DuplicateAgentResultError.
 *
 * @param {string} checkId
 * @param {object} result
 * @param {Database.Database} [db]
 * @returns {object}
 */
export function saveAgentResult(checkId, result, db = getDb()) {
  const validated = AgentResultSchema.parse({
    checkId,
    ...result,
  });

  const existingStmt = db.prepare(`
    SELECT id FROM agent_results WHERE check_id = ? AND agent = ? AND round = ?
  `);
  const existing = existingStmt.get(validated.checkId, validated.agent, validated.round);
  if (existing) {
    throw new DuplicateAgentResultError(validated.checkId, validated.agent, validated.round);
  }

  const stmt = db.prepare(`
    INSERT INTO agent_results (
      check_id, agent, round, kind, status, reason,
      flags_json, verified_json, new_entities_json, processed_json,
      unchecked_json, manual_checks_json, trace_json, notes, duration_ms,
      classifier_result_json, activity_json, summary, entity_status_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    stmt.run(
      validated.checkId,
      validated.agent,
      validated.round,
      validated.kind,
      validated.status,
      validated.reason ?? null,
      JSON.stringify(validated.flags),
      JSON.stringify(validated.verified),
      JSON.stringify(validated.newEntities),
      JSON.stringify(validated.processedEntities),
      JSON.stringify(validated.unchecked),
      JSON.stringify(validated.manualChecks),
      JSON.stringify(validated.trace || []),
      validated.notes || "",
      validated.durationMs,
      validated.classifierResult !== undefined ? JSON.stringify(validated.classifierResult) : null,
      JSON.stringify(validated.activity || []),
      validated.summary || "",
      JSON.stringify(validated.entityStatus || [])
    );
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.message?.includes("UNIQUE constraint failed")) {
      throw new DuplicateAgentResultError(validated.checkId, validated.agent, validated.round);
    }
    throw err;
  }

  const getStmt = db.prepare(`
    SELECT * FROM agent_results WHERE check_id = ? AND agent = ? AND round = ?
  `);
  const row = getStmt.get(validated.checkId, validated.agent, validated.round);
  return mapAgentResultRow(row);
}

/**
 * Helper to parse and validate an agent_results SQLite row.
 */
function mapAgentResultRow(row) {
  if (!row) return null;
  const classifierResult = row.classifier_result_json
    ? JSON.parse(row.classifier_result_json)
    : undefined;
  return AgentResultSchema.parse({
    id: row.id,
    checkId: row.check_id,
    agent: row.agent,
    round: row.round,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    summary: row.summary || "",
    activity: JSON.parse(row.activity_json || "[]"),
    entityStatus: JSON.parse(row.entity_status_json || "[]"),
    flags: JSON.parse(row.flags_json || "[]"),
    verified: JSON.parse(row.verified_json || "[]"),
    newEntities: JSON.parse(row.new_entities_json || "[]"),
    processedEntities: JSON.parse(row.processed_json || "[]"),
    unchecked: JSON.parse(row.unchecked_json || "[]"),
    manualChecks: JSON.parse(row.manual_checks_json || "[]"),
    trace: JSON.parse(row.trace_json || "[]"),
    notes: row.notes || "",
    durationMs: row.duration_ms,
    ...(classifierResult !== undefined ? { classifierResult } : {}),
  });
}

/**
 * Gets all agent results for a check.
 *
 * @param {string} checkId
 * @param {Database.Database} [db]
 * @returns {Array<object>}
 */
export function getAgentResults(checkId, db = getDb()) {
  const stmt = db.prepare(`
    SELECT * FROM agent_results WHERE check_id = ? ORDER BY round ASC, id ASC
  `);
  const rows = stmt.all(checkId);
  return rows.map(mapAgentResultRow);
}

/**
 * Atomically saves one agent result, adds entities (via addEntities INSERT OR IGNORE),
 * and appends events. On any failure or constraint violation, nothing is written.
 *
 * @param {string} checkId
 * @param {object} params
 * @param {object} params.result - AgentResult candidate
 * @param {Array<object>} [params.newEntities=[]] - Entities to add (e.g. from agent.newEntities)
 * @param {Array<object>} [params.events=[]] - ProgressEvent or CheckEventRow candidates
 * @param {Database.Database} [db]
 * @returns {{ result: object, addedEntitiesCount: number, eventsCount: number }}
 */
export function saveRoundResults(
  checkId,
  { result, newEntities = [], events = [] } = {},
  db = getDb()
) {
  if (!result || typeof result !== "object") {
    throw new Error("result is required for saveRoundResults");
  }

  // 1. Validate result against AgentResultSchema
  const validatedResult = AgentResultSchema.parse({
    checkId,
    ...result,
  });

  // 2. Validate entities against EntitySchema
  const validatedEntities = (newEntities || []).map((ent) =>
    EntitySchema.parse({
      checkId,
      ...ent,
    })
  );

  // 3. Validate events against CheckEventRowSchema
  const now = new Date().toISOString();
  const validatedEvents = (events || []).map((ev) =>
    CheckEventRowSchema.parse({
      checkId,
      round: ev.round ?? validatedResult.round,
      createdAt: ev.createdAt || now,
      ...ev,
    })
  );

  // Prepare SQL statements
  const checkExistingResultStmt = db.prepare(`
    SELECT id FROM agent_results WHERE check_id = ? AND agent = ? AND round = ?
  `);

  const insertResultStmt = db.prepare(`
    INSERT INTO agent_results (
      check_id, agent, round, kind, status, reason,
      flags_json, verified_json, new_entities_json, processed_json,
      unchecked_json, manual_checks_json, trace_json, notes, duration_ms,
      classifier_result_json, activity_json, summary, entity_status_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEntityStmt = db.prepare(`
    INSERT OR IGNORE INTO entities (check_id, kind, value, source, platform, org_type, purpose, direction, discovered_by, round, confirmed, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEventStmt = db.prepare(`
    INSERT INTO check_events (check_id, seq, round, type, agent, status, summary, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedEntitiesCount = 0;

  const tx = db.transaction(() => {
    // Check duplicate agent result
    const existing = checkExistingResultStmt.get(
      validatedResult.checkId,
      validatedResult.agent,
      validatedResult.round
    );
    if (existing) {
      throw new DuplicateAgentResultError(
        validatedResult.checkId,
        validatedResult.agent,
        validatedResult.round
      );
    }

    // Insert Agent Result
    try {
      insertResultStmt.run(
        validatedResult.checkId,
        validatedResult.agent,
        validatedResult.round,
        validatedResult.kind,
        validatedResult.status,
        validatedResult.reason ?? null,
        JSON.stringify(validatedResult.flags),
        JSON.stringify(validatedResult.verified),
        JSON.stringify(validatedResult.newEntities),
        JSON.stringify(validatedResult.processedEntities),
        JSON.stringify(validatedResult.unchecked),
        JSON.stringify(validatedResult.manualChecks),
        JSON.stringify(validatedResult.trace || []),
        validatedResult.notes || "",
        validatedResult.durationMs,
        validatedResult.classifierResult !== undefined
          ? JSON.stringify(validatedResult.classifierResult)
          : null,
        JSON.stringify(validatedResult.activity || []),
        validatedResult.summary || "",
        JSON.stringify(validatedResult.entityStatus || [])
      );
    } catch (err) {
      if (
        err.code === "SQLITE_CONSTRAINT_UNIQUE" ||
        err.message?.includes("UNIQUE constraint failed")
      ) {
        throw new DuplicateAgentResultError(
          validatedResult.checkId,
          validatedResult.agent,
          validatedResult.round
        );
      }
      throw err;
    }

    // Insert Entities (INSERT OR IGNORE)
    for (const ent of validatedEntities) {
      const info = insertEntityStmt.run(
        ent.checkId,
        ent.kind,
        ent.value,
        ent.source,
        ent.platform ?? null,
        ent.orgType ?? null,
        ent.purpose ?? null,
        ent.direction ?? null,
        ent.discoveredBy ?? null,
        ent.round,
        ent.confirmed ? 1 : 0,
        ent.evidence ? JSON.stringify(ent.evidence) : null
      );
      if (info.changes > 0) {
        addedEntitiesCount++;
      }
    }

    // Insert Events
    let currentSeq = (
      db.prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM check_events WHERE check_id = ?`).get(validatedResult.checkId)?.max_seq || 0
    );

    for (const ev of validatedEvents) {
      currentSeq++;
      const eventSeq = ev.seq ?? currentSeq;
      const payloadJson = ev.payload_json || JSON.stringify({
        seq: eventSeq,
        checkId: ev.checkId,
        ts: ev.createdAt || new Date().toISOString(),
        round: ev.round ?? validatedResult.round,
        agent: ev.agent ?? validatedResult.agent,
        type: ev.type,
        status: ev.status ?? null,
        summary: ev.summary ?? null,
      });

      insertEventStmt.run(
        ev.checkId,
        eventSeq,
        ev.round ?? null,
        ev.type,
        ev.agent ?? null,
        ev.status ?? null,
        ev.summary ?? null,
        payloadJson,
        ev.createdAt
      );
    }
  });

  tx();

  const getStmt = db.prepare(`
    SELECT * FROM agent_results WHERE check_id = ? AND agent = ? AND round = ?
  `);
  const row = getStmt.get(
    validatedResult.checkId,
    validatedResult.agent,
    validatedResult.round
  );

  return {
    result: mapAgentResultRow(row),
    addedEntitiesCount,
    eventsCount: validatedEvents.length,
  };
}

// -------------------------------------------------------------
// CHECK EVENTS REPOSITORY
// -------------------------------------------------------------

/**
 * Appends an event to the check_events log.
 * Enforces the 4 KB serialization limit, schema validation, and monotonic seq assignment.
 *
 * @param {string} checkId
 * @param {object} event
 * @param {Database.Database} [db]
 * @returns {object}
 */
export function appendEvent(checkId, event, db = getDb()) {
  const now = new Date().toISOString();

  // Normalize legacy types if present
  let normalizedType = event.type;
  let normalizedStatus = event.status;
  if (normalizedType === "agent" || normalizedType === "error") {
    normalizedType = "agent_status";
    if (event.type === "error" || normalizedStatus === "failed") {
      normalizedStatus = "could_not_check";
    } else if (normalizedStatus === "completed") {
      normalizedStatus = "done";
    }
  }

  // 1. Truncate oversized fields first
  const truncated = truncateEventPayload({
    ...event,
    type: normalizedType,
    status: normalizedStatus,
  });

  // 2. Synchronously & atomically determine/assign seq and insert inside transaction
  const insertTx = db.transaction(() => {
    let seq = truncated.seq;
    if (seq === undefined || seq === null) {
      const maxRow = db
        .prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM check_events WHERE check_id = ?`)
        .get(checkId);
      seq = (maxRow?.max_seq || 0) + 1;
    }

    const common = {
      seq,
      checkId,
      ts: truncated.ts || truncated.createdAt || now,
      round: truncated.round !== undefined && truncated.round !== null ? truncated.round : 0,
      agent: truncated.agent ?? null,
    };

    let candidate;
    switch (normalizedType) {
      case "agent_status":
        candidate = {
          ...common,
          type: "agent_status",
          status: ["started", "done", "skipped", "could_not_check"].includes(truncated.status)
            ? truncated.status
            : "done",
          summary: truncated.summary || "",
        };
        break;
      case "tool_start":
        candidate = {
          ...common,
          type: "tool_start",
          callId: truncated.callId,
          tool: truncated.tool,
          label: truncated.label,
          input: truncated.input ?? "",
        };
        break;
      case "tool_end":
        candidate = {
          ...common,
          type: "tool_end",
          callId: truncated.callId,
          tool: truncated.tool,
          status: truncated.status,
          durationMs: truncated.durationMs ?? 0,
          summary: truncated.summary ?? "",
          detail: truncated.detail,
        };
        break;
      case "note":
        candidate = {
          ...common,
          type: "note",
          text: String(truncated.text || truncated.summary || "").slice(0, 80),
        };
        break;
      case "flag":
        candidate = {
          ...common,
          type: "flag",
          flagId: truncated.flagId,
          title: truncated.title,
          severity: truncated.severity,
          evidence: truncated.evidence || [],
        };
        break;
      case "verdict":
        candidate = {
          ...common,
          type: "verdict",
          claim: truncated.claim,
          verdict: truncated.verdict,
          sources: truncated.sources || [],
        };
        break;
      case "entity":
        candidate = {
          ...common,
          type: "entity",
          kind: truncated.kind,
          value: truncated.value,
          evidence: truncated.evidence,
        };
        break;
      case "round":
        candidate = {
          ...common,
          type: "round",
          round: Math.max(1, Math.min(2, Number(truncated.round) || 1)),
        };
        break;
      case "stage":
        candidate = {
          ...common,
          type: "stage",
          stage: String(truncated.stage || truncated.summary || truncated.status || "stage").slice(0, 64),
        };
        break;
      case "complete":
        candidate = {
          ...common,
          type: "complete",
        };
        break;
      case "activity":
        candidate = {
          ...common,
          type: "activity",
          entry: truncated.entry,
        };
        break;
      case "evidence_transfer":
        candidate = {
          ...common,
          type: "evidence_transfer",
          fromAgent: truncated.fromAgent ?? null,
          toAgent: truncated.toAgent,
          transferType: truncated.transferType,
          entityIds: Array.isArray(truncated.entityIds) ? truncated.entityIds : [],
          evidenceIds: Array.isArray(truncated.evidenceIds) ? truncated.evidenceIds : [],
          outcome: truncated.outcome || "",
        };
        break;
      default:
        candidate = {
          ...truncated,
          ...common,
        };
        break;
    }

    // 3. Validate against TraceEventSchema (may throw on invalid input per spec)
    const validated = TraceEventSchema.parse(candidate);
    const payloadJson = JSON.stringify(validated);

    const stmt = db.prepare(`
      INSERT INTO check_events (check_id, seq, round, type, agent, status, summary, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const summary =
      event.summary ??
      (validated.type === "note"
        ? validated.text
        : validated.type === "agent_status"
          ? validated.summary
          : validated.type === "stage"
            ? `${validated.stage} started`
            : validated.type === "round"
              ? `round ${validated.round} started`
              : validated.type === "complete"
                ? "investigation complete"
                : validated.type === "activity"
                  ? (validated.entry?.title || "activity")
                  : validated.type === "evidence_transfer"
                    ? validated.outcome
                    : null);

    const status =
      event.status ??
      (validated.type === "agent_status"
        ? validated.status
        : validated.type === "activity"
          ? (validated.entry?.status || null)
          : null);

    const eventType = event.type || validated.type;
    const agent = event.agent ?? validated.agent ?? null;

    const info = stmt.run(
      checkId,
      validated.seq,
      validated.round ?? null,
      eventType,
      agent,
      status,
      summary,
      payloadJson,
      validated.ts
    );

    return {
      ...validated,
      id: Number(info.lastInsertRowid),
    };
  });

  return insertTx();
}

/**
 * Retrieves ordered TraceEvents for a check with seq greater than the given seq.
 * Tolerates backfilled legacy rows (returns safe legacy shape) without throwing.
 *
 * @param {string} checkId
 * @param {number} [seq=0]
 * @param {Database.Database} [db]
 * @returns {Array<object>}
 */
export function listEventsAfter(checkId, seq = 0, db = getDb()) {
  const stmt = db.prepare(`
    SELECT * FROM check_events
    WHERE check_id = ? AND seq > ?
    ORDER BY seq ASC
  `);
  const rows = stmt.all(checkId, Number(seq));

  return rows.map((row) => {
    if (row.type === "error") {
      return {
        type: "error",
        code: "CHECK_FAILED",
        message: "Check investigation encountered a failure",
        seq: row.seq,
        checkId: row.check_id,
        ts: row.created_at,
        id: row.id,
      };
    }

    if (row.type === "agent") {
      return {
        type: "agent",
        round: row.round ?? 1,
        agent: row.agent || "unknown",
        status: row.status || "completed",
        seq: row.seq,
        checkId: row.check_id,
        ts: row.created_at,
        id: row.id,
      };
    }

    let payload = null;
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) : null;
    } catch {
      payload = null;
    }

    if (payload && payload.type) {
      try {
        return {
          ...TraceEventSchema.parse({
            ...payload,
            seq: row.seq,
            checkId: row.check_id,
            round: payload.round !== undefined ? payload.round : (row.round ?? 0),
            ts: payload.ts || row.created_at,
            agent: payload.agent !== undefined ? payload.agent : (row.agent ?? null),
          }),
          id: row.id,
        };
      } catch {
        // Fall through to safe legacy shape
      }
    }

    // Legacy row or unparseable payload: return safe legacy shape without throwing
    return {
      type: row.type,
      status: row.status,
      summary: row.summary,
      seq: row.seq,
      checkId: row.check_id,
      round: row.round ?? 0,
      agent: row.agent ?? null,
      ts: row.created_at,
      ...(payload && typeof payload === "object" ? payload : {}),
      id: row.id,
    };
  });
}

/**
 * Gets all events for a check.
 *
 * @param {string} checkId
 * @param {Database.Database} [db]
 * @returns {Array<object>}
 */
export function getEvents(checkId, db = getDb()) {
  const stmt = db.prepare(`
    SELECT * FROM check_events WHERE check_id = ? ORDER BY id ASC
  `);
  const rows = stmt.all(checkId);

  return rows.map((row) =>
    CheckEventRowSchema.parse({
      id: row.id,
      checkId: row.check_id,
      round: row.round,
      type: row.type,
      agent: row.agent,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at,
    })
  );
}

/**
 * Gets agent-associated events for a check to synthesize live activity cards.
 *
 * @param {string} checkId
 * @param {Database.Database} [db]
 * @returns {Array<{ agent: string, type: string, status: string | null, payload_json: string | null }>}
 */
export function getAgentCheckEvents(checkId, db = getDb()) {
  const stmt = db.prepare(`
    SELECT agent, type, status, payload_json
    FROM check_events
    WHERE check_id = ? AND agent IS NOT NULL
    ORDER BY seq ASC
  `);
  return stmt.all(checkId);
}

// -------------------------------------------------------------
// REPORT REPOSITORY
// -------------------------------------------------------------

/**
 * Saves a report for a check.
 *
 * @param {string} checkId
 * @param {object} report
 * @param {Database.Database} [db]
 * @returns {object}
 */
export function saveReport(checkId, report, db = getDb()) {
  const now = new Date().toISOString();
  const validated = ReportSchema.parse({
    ...report,
    checkId,
    generatedAt: report.generatedAt || now,
  });

  const stmt = db.prepare(`
    INSERT INTO reports (check_id, report_json, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(check_id) DO UPDATE SET
      report_json = excluded.report_json,
      created_at = excluded.created_at
  `);

  stmt.run(checkId, JSON.stringify(validated), validated.generatedAt);
  return getReport(checkId, db);
}

/**
 * Gets the report for a check.
 *
 * @param {string} checkId
 * @param {Database.Database} [db]
 * @returns {object | null}
 */
export function getReport(checkId, db = getDb()) {
  const stmt = db.prepare(`SELECT * FROM reports WHERE check_id = ?`);
  const row = stmt.get(checkId);
  if (!row) return null;

  const parsed = JSON.parse(row.report_json);
  return ReportSchema.parse(parsed);
}

// -------------------------------------------------------------
// FEEDBACK REPOSITORY
// -------------------------------------------------------------

/**
 * Saves feedback for a check or anonymous feedback.
 *
 * @param {object} feedback
 * @param {Database.Database} [db]
 * @returns {object}
 */
export function saveFeedback(feedback, db = getDb()) {
  const now = new Date().toISOString();
  const validated = FeedbackSchema.parse({
    createdAt: feedback.createdAt || now,
    ...feedback,
  });

  const stmt = db.prepare(`
    INSERT INTO feedback (check_id, verdict, risk_level_shown, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    validated.checkId ?? null,
    validated.verdict,
    validated.riskLevelShown,
    validated.comment ?? null,
    validated.createdAt
  );

  return {
    ...validated,
    id: Number(info.lastInsertRowid),
  };
}

/**
 * Saves feedback for a check atomically, preventing duplicate feedback per checkId.
 * Executes within a single transaction without schema migrations.
 * If feedback already exists for checkId, returns { duplicate: true }.
 * Otherwise inserts and returns { duplicate: false, feedback: object }.
 *
 * @param {object} feedback
 * @param {Database.Database} [db]
 * @returns {{ duplicate: boolean, feedback?: object }}
 */
export function saveFeedbackUnique(feedback, db = getDb()) {
  const now = new Date().toISOString();
  const validated = FeedbackSchema.parse({
    createdAt: feedback.createdAt || now,
    ...feedback,
  });

  const tx = db.transaction(() => {
    if (validated.checkId) {
      const existing = db.prepare(`SELECT 1 FROM feedback WHERE check_id = ? LIMIT 1`).get(validated.checkId);
      if (existing) {
        return { duplicate: true };
      }
    }

    const stmt = db.prepare(`
      INSERT INTO feedback (check_id, verdict, risk_level_shown, comment, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      validated.checkId ?? null,
      validated.verdict,
      validated.riskLevelShown,
      validated.comment ?? null,
      validated.createdAt
    );

    return {
      duplicate: false,
      feedback: {
        ...validated,
        id: Number(info.lastInsertRowid),
      },
    };
  });

  return tx();
}

// -------------------------------------------------------------
// GRAPH REPOSITORY
// -------------------------------------------------------------

/**
 * Inserts or updates a node in graph_nodes.
 *
 * @param {object} node
 * @param {Database.Database} [db]
 * @returns {object}
 */
export function upsertGraphNode(node, db = getDb()) {
  const now = new Date().toISOString();
  const candidate = {
    firstSeen: node.firstSeen || now,
    lastSeen: node.lastSeen || now,
    reportCount: node.reportCount || 1,
    ...node,
  };
  const validated = GraphNodeSchema.parse(candidate);

  const stmt = db.prepare(`
    INSERT INTO graph_nodes (kind, value, first_seen, last_seen, report_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, value) DO UPDATE SET
      last_seen = excluded.last_seen,
      report_count = report_count + 1
  `);

  stmt.run(
    validated.kind,
    validated.value,
    validated.firstSeen,
    validated.lastSeen,
    validated.reportCount
  );

  const getStmt = db.prepare(`SELECT * FROM graph_nodes WHERE kind = ? AND value = ?`);
  const row = getStmt.get(validated.kind, validated.value);

  return GraphNodeSchema.parse({
    id: row.id,
    kind: row.kind,
    value: row.value,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    reportCount: row.report_count,
  });
}

/**
 * Adds an edge in graph_edges.
 *
 * @param {object} edge
 * @param {Database.Database} [db]
 * @returns {object}
 */
export function addGraphEdge(edge, db = getDb()) {
  const now = new Date().toISOString();
  const rawNodeA = edge.nodeA;
  const rawNodeB = edge.nodeB;

  if (rawNodeA === rawNodeB) {
    throw new Error(`Self-loop edges are not allowed: nodeA and nodeB are identical (${rawNodeA})`);
  }

  // Canonical ordering: nodeA < nodeB
  const nodeA = Math.min(rawNodeA, rawNodeB);
  const nodeB = Math.max(rawNodeA, rawNodeB);

  const validated = GraphEdgeSchema.parse({
    createdAt: edge.createdAt || now,
    ...edge,
    nodeA,
    nodeB,
  });

  const stmt = db.prepare(`
    INSERT INTO graph_edges (node_a, node_b, check_ref, created_at)
    VALUES (?, ?, ?, ?)
  `);

  const info = stmt.run(
    validated.nodeA,
    validated.nodeB,
    validated.checkRef,
    validated.createdAt
  );

  return {
    ...validated,
    id: Number(info.lastInsertRowid),
  };
}

// -------------------------------------------------------------
// CLEANUP & PURGE
// -------------------------------------------------------------

/**
 * Deletes expired checks and removes any uploaded image files associated with them.
 * Verifies that file paths are strictly within the designated uploads directory.
 *
 * @param {string} [uploadsDir] - Directory where uploads reside
 * @param {Database.Database} [db]
 * @returns {{ deletedCount: number, deletedFiles: string[] }}
 */
export function deleteExpired(uploadsDir = "./uploads", db = getDb()) {
  const now = new Date().toISOString();
  const resolvedUploadsDir = path.resolve(uploadsDir);

  // Find all expired checks
  const getExpiredStmt = db.prepare(`SELECT id FROM checks WHERE expires_at < ?`);
  const expiredRows = getExpiredStmt.all(now);
  const expiredCheckIds = expiredRows.map((r) => r.id);

  if (expiredCheckIds.length === 0) {
    return { deletedCount: 0, deletedFiles: [] };
  }

  // Find all associated files in check_inputs
  const placeholders = expiredCheckIds.map(() => "?").join(",");
  const getFilesStmt = db.prepare(
    `SELECT file_path FROM check_inputs WHERE check_id IN (${placeholders}) AND file_path IS NOT NULL`
  );
  const fileRows = getFilesStmt.all(...expiredCheckIds);

  const deletedFiles = [];
  for (const row of fileRows) {
    if (row.file_path) {
      const resolvedPath = path.resolve(row.file_path);
      // Strictly verify path containment inside uploadsDir to prevent directory traversal
      if (resolvedPath.startsWith(resolvedUploadsDir + path.sep)) {
        if (fs.existsSync(resolvedPath)) {
          fs.unlinkSync(resolvedPath);
          deletedFiles.push(resolvedPath);
        }
      } else {
        throw new Error(
          `Security violation: Attempted to delete file outside upload directory: ${resolvedPath}`
        );
      }
    }
  }

  // Delete checks in SQLite (foreign keys ON DELETE CASCADE cleans up check_inputs, entities, results, events, reports)
  const deleteStmt = db.prepare(`DELETE FROM checks WHERE id IN (${placeholders})`);
  const info = deleteStmt.run(...expiredCheckIds);

  return {
    deletedCount: info.changes,
    deletedFiles,
  };
}

/**
 * Purges expired cache entries.
 *
 * @param {Database.Database} [db]
 * @returns {number} Number of purged entries
 */
export function purgeCache(db = getDb()) {
  return purge(db);
}

/**
 * Retrieves events for a check after a given event ID in ascending order.
 *
 * @param {string} checkId
 * @param {number} [afterId=0]
 * @param {number} [limit=100]
 * @param {Database.Database} [db]
 * @returns {Array<object>} Parsed events
 */
export function getEventsAfter(checkId, afterId = 0, limit = 100, db = getDb()) {
  const stmt = db.prepare(`
    SELECT * FROM check_events
    WHERE check_id = ? AND id > ?
    ORDER BY id ASC
    LIMIT ?
  `);
  const rows = stmt.all(checkId, afterId, limit);
  return rows.map((row) =>
    CheckEventRowSchema.parse({
      id: row.id,
      checkId: row.check_id,
      round: row.round,
      type: row.type,
      agent: row.agent,
      status: row.status,
      summary: row.summary,
      createdAt: row.created_at,
    })
  );
}

/**
 * Lists checks in non-terminal statuses that have not been updated since a cutoff time.
 *
 * @param {string[]} [statuses]
 * @param {number} [olderThanMs=300000] Default 5 minutes
 * @param {number} [now=Date.now()]
 * @param {Database.Database} [db]
 * @returns {Array<{ id: string, status: string }>}
 */
export function listStaleChecks(
  statuses = ["extracting", "investigating", "scoring"],
  olderThanMs = 300000,
  now = Date.now(),
  db = getDb()
) {
  if (!statuses || statuses.length === 0) return [];
  const cutoffIso = new Date(now - olderThanMs).toISOString();
  const placeholders = statuses.map(() => "?").join(", ");
  const stmt = db.prepare(`
    SELECT id, status FROM checks
    WHERE status IN (${placeholders})
      AND updated_at < ?
    ORDER BY updated_at ASC
  `);
  return stmt.all(...statuses, cutoffIso);
}

/**
 * Returns the count of active checks currently in the given statuses.
 *
 * @param {string[]} [statuses]
 * @param {Database.Database} [db]
 * @returns {number}
 */
export function countActiveChecks(
  statuses = ["extracting", "investigating", "scoring"],
  db = getDb()
) {
  if (!statuses || statuses.length === 0) return 0;
  const placeholders = statuses.map(() => "?").join(", ");
  const stmt = db.prepare(`SELECT count(*) as count FROM checks WHERE status IN (${placeholders})`);
  return stmt.get(...statuses).count;
}

/**
 * Atomically marks a check as failed with a valid failure reason code and appends an error event.
 * Rejects transitions from terminal states.
 *
 * @param {string} checkId
 * @param {string} reasonCode Must be a member of FAILURE_REASON_CODES
 * @param {object} [options]
 * @param {string} [options.summary="Investigation failed"]
 * @param {Database.Database} [options.db]
 * @returns {object} Updated check
 */
export function markCheckFailed(checkId, reasonCode, { summary = "Investigation failed", db = getDb() } = {}) {
  const current = getCheck(checkId, db);
  if (!current) {
    throw new Error(`Check not found: ${checkId}`);
  }

  // Validate state transition (fails if already report_ready or failed)
  assertTransition(current.status, "failed");

  // Validate failureReason member
  if (!FAILURE_REASON_CODES.includes(reasonCode)) {
    throw new Error(`Invalid failureReason code: ${reasonCode}`);
  }

  const updatedAt = new Date().toISOString();

  const updateStmt = db.prepare(`
    UPDATE checks
    SET status = 'failed', failure_reason = ?, updated_at = ?
    WHERE id = ?
  `);

  const maxRow = db
    .prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM check_events WHERE check_id = ?`)
    .get(checkId);
  const nextSeq = (maxRow?.max_seq || 0) + 1;
  const payloadJson = JSON.stringify({
    seq: nextSeq,
    checkId,
    ts: updatedAt,
    round: current.currentRound || 1,
    agent: null,
    type: "agent_status",
    status: "could_not_check",
    summary,
  });

  const eventStmt = db.prepare(`
    INSERT INTO check_events (check_id, seq, round, type, agent, status, summary, payload_json, created_at)
    VALUES (?, ?, ?, 'error', NULL, 'could_not_check', ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    updateStmt.run(reasonCode, updatedAt, checkId);
    eventStmt.run(checkId, nextSeq, current.currentRound || 1, summary, payloadJson, updatedAt);
  });

  tx();

  return getCheck(checkId, db);
}

/**
 * Deletes a check and cascaded child records by check ID.
 *
 * @param {string} checkId
 * @param {Database.Database} [db]
 * @returns {number} Number of deleted checks
 */
export function deleteCheck(checkId, db = getDb()) {
  const stmt = db.prepare(`DELETE FROM checks WHERE id = ?`);
  const info = stmt.run(checkId);
  return info.changes;
}

/**
 * Saves evidence ledger entries for a check.
 * Replaces existing entries if matching ID.
 *
 * @param {string} checkId
 * @param {Array<object>} entries
 * @param {Database.Database} [db]
 */
export function saveLedger(checkId, entries, db = getDb()) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const insert = db.prepare(`
    INSERT OR REPLACE INTO evidence_ledger (
      id, check_id, agent, round, kind, flag_id, claim_key,
      quote_or_url, evidence_type, verification_status, confidence,
      supporting_source, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((items) => {
    for (const item of items) {
      insert.run(
        item.id,
        checkId,
        item.agent,
        item.round ?? 1,
        item.kind,
        item.flagId || null,
        item.claimKey,
        item.quoteOrUrl || null,
        item.evidenceType,
        item.verificationStatus,
        item.confidence,
        item.supportingSource || null,
        item.timestamp || new Date().toISOString()
      );
    }
  });
  tx(entries);
}

/**
 * Retrieves all evidence ledger entries for a check, sorted by timestamp ascending.
 *
 * @param {string} checkId
 * @param {Database.Database} [db]
 * @returns {Array<object>}
 */
export function getLedger(checkId, db = getDb()) {
  const rows = db.prepare(`SELECT * FROM evidence_ledger WHERE check_id = ? ORDER BY timestamp ASC`).all(checkId);
  return rows.map((r) => ({
    id: r.id,
    checkId: r.check_id,
    agent: r.agent,
    round: r.round,
    kind: r.kind,
    flagId: r.flag_id,
    claimKey: r.claim_key,
    quoteOrUrl: r.quote_or_url,
    evidenceType: r.evidence_type,
    verificationStatus: r.verification_status,
    confidence: r.confidence,
    supportingSource: r.supporting_source,
    timestamp: r.timestamp,
  }));
}

/**
 * Creates or resets a crawl record in 'running' status.
 *
 * @param {string} checkId
 * @param {string} entityId
 * @param {string} [startedAt]
 * @param {Database.Database} [db]
 * @returns {object} Created or updated crawl record
 */
export function createCrawl(checkId, entityId, startedAt = new Date().toISOString(), db = getDb()) {
  const existing = db.prepare(`SELECT * FROM crawl_results WHERE check_id = ? AND entity_id = ?`).get(checkId, entityId);
  if (existing) {
    if (existing.status === "failed") {
      db.prepare(`
        UPDATE crawl_results
        SET status = 'running', started_at = ?, finished_at = NULL, error_code = NULL, result_json = NULL, updated_at = ?
        WHERE check_id = ? AND entity_id = ?
      `).run(startedAt, startedAt, checkId, entityId);
      return getCrawl(checkId, entityId, db);
    }
    return getCrawl(checkId, entityId, db);
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO crawl_results (id, check_id, entity_id, status, started_at, created_at, updated_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(id, checkId, entityId, startedAt, startedAt, startedAt);

  return getCrawl(checkId, entityId, db);
}

/**
 * Marks a crawl as completed with valid CrawlResult.
 *
 * @param {string} checkId
 * @param {string} entityId
 * @param {object} result CrawlResult object
 * @param {string} [finishedAt]
 * @param {Database.Database} [db]
 * @returns {object} Updated crawl record
 */
export function markCrawlDone(checkId, entityId, result, finishedAt = new Date().toISOString(), db = getDb()) {
  const parsed = CrawlResultSchema.parse(result);
  db.prepare(`
    UPDATE crawl_results
    SET status = 'done', result_json = ?, finished_at = ?, updated_at = ?
    WHERE check_id = ? AND entity_id = ?
  `).run(JSON.stringify(parsed), finishedAt, finishedAt, checkId, entityId);

  return getCrawl(checkId, entityId, db);
}

/**
 * Marks a crawl as failed with error code.
 *
 * @param {string} checkId
 * @param {string} entityId
 * @param {string} errorCode
 * @param {string} [finishedAt]
 * @param {Database.Database} [db]
 * @returns {object} Updated crawl record
 */
export function markCrawlFailed(checkId, entityId, errorCode, finishedAt = new Date().toISOString(), db = getDb()) {
  db.prepare(`
    UPDATE crawl_results
    SET status = 'failed', error_code = ?, finished_at = ?, updated_at = ?
    WHERE check_id = ? AND entity_id = ?
  `).run(errorCode, finishedAt, finishedAt, checkId, entityId);

  return getCrawl(checkId, entityId, db);
}

/**
 * Retrieves crawl record by check ID and entity ID.
 *
 * @param {string} checkId
 * @param {string} entityId
 * @param {Database.Database} [db]
 * @returns {object|null} Formatted crawl record with parsed result
 */
export function getCrawl(checkId, entityId, db = getDb()) {
  const row = db.prepare(`SELECT * FROM crawl_results WHERE check_id = ? AND entity_id = ?`).get(checkId, entityId);
  if (!row) return null;

  let parsedResult = null;
  if (row.result_json) {
    try {
      const raw = JSON.parse(row.result_json);
      const res = CrawlResultSchema.safeParse(raw);
      if (res.success) {
        parsedResult = res.data;
      }
    } catch {
      // Return null on parsing failure
    }
  }

  return {
    id: row.id,
    checkId: row.check_id,
    entityId: row.entity_id,
    status: row.status,
    result: parsedResult,
    errorCode: row.error_code || null,
    startedAt: row.started_at,
    finishedAt: row.finished_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Sweeps crawls stuck in 'running' status longer than timeoutSeconds.
 *
 * @param {number} [timeoutSeconds=300]
 * @param {Database.Database} [db]
 * @returns {number} Number of crawls updated to failed
 */
export function markStaleCrawlsFailed(timeoutSeconds = 300, db = getDb()) {
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000).toISOString();
  const info = db.prepare(`
    UPDATE crawl_results
    SET status = 'failed', error_code = 'server_restart', finished_at = datetime('now'), updated_at = datetime('now')
    WHERE status = 'running' AND started_at < ?
  `).run(cutoff);

  return info.changes;
}




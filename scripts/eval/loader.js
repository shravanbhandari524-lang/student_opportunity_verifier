/**
 * scripts/eval/loader.js
 *
 * Dataset loader supporting CSV and JSON formats, with validation, duplicate detection,
 * group leakage checks, and classifier dataset overlap detection.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeEvalCase } from "./schema.js";

/**
 * Normalizes text for deduplication and overlap hashing:
 * Lowercases, strips punctuation and URLs, and collapses all whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeTextForHashing(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes deterministic SHA-256 hash of normalized text.
 *
 * @param {string} text
 * @returns {string}
 */
export function hashNormalizedText(text) {
  const norm = normalizeTextForHashing(text);
  return crypto.createHash("sha256").update(norm).digest("hex");
}

/**
 * Minimal RFC 4180 CSV parser for Node.js without external dependencies.
 * Handles quoted fields, escaped double quotes (""), and commas/newlines within quotes.
 *
 * @param {string} csvText
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(csvText) {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;
  let i = 0;

  while (i < csvText.length) {
    const char = csvText[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < csvText.length && csvText[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ",") {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      } else if (char === "\r") {
        if (i + 1 < csvText.length && csvText[i + 1] === "\n") {
          i++;
        }
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === "\n") {
        currentRow.push(currentField);
        currentField = "";
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const records = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0].trim() === "") continue; // skip blank trailing line
    const record = {};
    for (let c = 0; c < headers.length; c++) {
      record[headers[c]] = row[c] !== undefined ? row[c].trim() : "";
    }
    records.push(record);
  }

  return records;
}

/**
 * Loads text hashes from the classifier training dataset for overlap checks.
 *
 * @param {string} [classifierDatasetPath]
 * @returns {Set<string>} Set of normalized text hashes
 */
export function loadClassifierHashes(classifierDatasetPath) {
  const defaultPath = path.join(process.cwd(), "services", "classifier", "data", "dataset.csv");
  const targetPath = classifierDatasetPath || defaultPath;
  const hashes = new Set();

  if (!fs.existsSync(targetPath)) {
    return hashes;
  }

  try {
    const rawCsv = fs.readFileSync(targetPath, "utf8");
    const records = parseCsv(rawCsv);
    for (const rec of records) {
      if (rec.text) {
        const h = hashNormalizedText(rec.text);
        if (h) hashes.add(h);
      }
    }
  } catch {
    // Non-fatal, return whatever hashes collected
  }

  return hashes;
}

/**
 * Loads and validates evaluation dataset from file (CSV or JSON).
 *
 * Performs:
 * 1. Zod schema validation (enums, required fields, text/link constraint).
 * 2. Duplicate detection by normalized text hash.
 * 3. GroupId leakage check: verifies cases with same group_id share the same expected_level and scam_type.
 * 4. Overlap warning against classifier dataset.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {string} [options.classifierDatasetPath]
 * @returns {{
 *   cases: Array<import("./schema.js").EvalCaseSchema>,
 *   duplicates: Array<{ id1: string, id2: string, textHash: string }>,
 *   groupViolations: Array<{ groupId: string, issue: string }>,
 *   classifierOverlaps: Array<{ id: string, textHash: string }>,
 *   summary: {
 *     total: number,
 *     byLevel: Record<string, number>,
 *     byScamType: Record<string, number>,
 *     byLanguage: Record<string, number>,
 *     byProvenance: Record<string, number>,
 *     disagreementsCount: number
 *   }
 * }}
 */
export function loadEvaluationDataset(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Evaluation dataset file not found: ${filePath}`);
  }

  const fileContent = fs.readFileSync(filePath, "utf8");
  let rawCases = [];

  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(fileContent);
    rawCases = Array.isArray(parsed) ? parsed : parsed.cases || [];
  } else if (filePath.endsWith(".csv")) {
    rawCases = parseCsv(fileContent);
  } else {
    throw new Error(`Unsupported dataset format: ${filePath}. Must be .csv or .json`);
  }

  const cases = [];
  const textHashMap = new Map();
  const duplicates = [];
  const groupMap = new Map();
  const groupViolations = [];
  const classifierHashes = loadClassifierHashes(options.classifierDatasetPath);
  const classifierOverlaps = [];

  const summary = {
    total: 0,
    byLevel: { low: 0, medium: 0, high: 0, cannot_verify: 0 },
    byScamType: {
      scholarship: 0,
      internship: 0,
      task_job: 0,
      mule_offer: 0,
      competition: 0,
      overseas_agent: 0,
      unknown: 0,
    },
    byLanguage: { en: 0, hi: 0 },
    byTextLanguage: { en: 0, hi: 0, hinglish: 0, other: 0 },
    byProvenance: { synthetic: 0, real_public: 0, paraphrased: 0 },
    disagreementsCount: 0,
    qualifyingCount: 0,
  };

  for (let idx = 0; idx < rawCases.length; idx++) {
    const raw = rawCases[idx];
    const c = normalizeEvalCase(raw);

    // 1. Duplicate detection by normalized text hash
    if (c.text) {
      const h = hashNormalizedText(c.text);
      if (h) {
        if (textHashMap.has(h)) {
          duplicates.push({
            id1: textHashMap.get(h),
            id2: c.id,
            textHash: h,
          });
        } else {
          textHashMap.set(h, c.id);
        }

        // Classifier overlap check
        if (classifierHashes.has(h)) {
          classifierOverlaps.push({ id: c.id, textHash: h });
        }
      }
    }

    // 2. Group ID consistency check (same groupId must share expectedLevel and scamType)
    if (c.groupId) {
      if (groupMap.has(c.groupId)) {
        const existing = groupMap.get(c.groupId);
        if (existing.expectedLevel !== c.expectedLevel) {
          groupViolations.push({
            groupId: c.groupId,
            issue: `Conflicting expectedLevel in group '${c.groupId}' between case ${existing.id} (${existing.expectedLevel}) and case ${c.id} (${c.expectedLevel})`,
          });
        }
        if (existing.scamType !== c.scamType) {
          groupViolations.push({
            groupId: c.groupId,
            issue: `Conflicting scamType in group '${c.groupId}' between case ${existing.id} (${existing.scamType}) and case ${c.id} (${c.scamType})`,
          });
        }
      } else {
        groupMap.set(c.groupId, { id: c.id, expectedLevel: c.expectedLevel, scamType: c.scamType });
      }
    }

    // 3. Aggregate summary counts
    summary.total++;
    summary.byLevel[c.expectedLevel] = (summary.byLevel[c.expectedLevel] || 0) + 1;
    summary.byScamType[c.scamType] = (summary.byScamType[c.scamType] || 0) + 1;
    summary.byLanguage[c.language] = (summary.byLanguage[c.language] || 0) + 1;
    if (c.textLanguage) {
      summary.byTextLanguage[c.textLanguage] = (summary.byTextLanguage[c.textLanguage] || 0) + 1;
    }
    summary.byProvenance[c.sourceType] = (summary.byProvenance[c.sourceType] || 0) + 1;
    if (c.hasLabelDisagreement) {
      summary.disagreementsCount++;
    }

    // Qualifying case rule: non-synthetic (real_public or paraphrased),
    // both labelers non-empty, equal, and agreeing with expected_level.
    const isNonSynthetic = c.sourceType === "real_public" || c.sourceType === "paraphrased";
    const labelsAgree = Boolean(c.labeler1 && c.labeler2 && c.labeler1 === c.labeler2 && c.labeler1 === c.expectedLevel);
    if (isNonSynthetic && labelsAgree) {
      summary.qualifyingCount = (summary.qualifyingCount || 0) + 1;
    }

    cases.push(c);
  }

  return {
    cases,
    duplicates,
    groupViolations,
    classifierOverlaps,
    summary,
  };
}

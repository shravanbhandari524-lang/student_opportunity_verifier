/**
 * lib/graph.js
 *
 * Scam intelligence graph repository wrapper for Layer L2.
 *
 * Rules:
 * - Upserts and links entity nodes in `graph_nodes` and `graph_edges`.
 * - Validates write policy: only checks with risk_level === "high" and consent === true
 *   can be recorded into the scam graph.
 * - Allowed entity kinds for graph recording: domain, upi, phone, handle, company.
 * - checkRef is a SHA-256 hash (or hex string) of checkId; checkId is never stored as a foreign key in graph.
 * - Node values are normalized according to kind (domain -> normalizeDomain, upi -> normalizeUpi, etc.).
 * - Atomicity: linking all nodes from a report runs in a single transaction.
 */

import crypto from "node:crypto";
import { getDb, upsertGraphNode, addGraphEdge, getCheck, getEntities } from "./db/index.js";
import {
  normalizeDomain,
  normalizeUpi,
  normalizeHandle,
  normalizeCompany,
  isValidE164,
} from "./contracts/normalize.js";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import knownDomainsData from "./data/known-domains.json" with { type: "json" };
import freeEmailDomainsData from "./data/free-email-domains.json" with { type: "json" };

export const ALLOWED_GRAPH_KINDS = new Set(["domain", "upi", "phone", "handle", "company"]);

/**
 * Normalizes an identifier value based on its kind.
 *
 * @param {string} kind
 * @param {string} value
 * @returns {string | null} Normalized value or null if invalid
 */
export function normalizeGraphValue(kind, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const val = value.trim();

  switch (kind) {
    case "domain": {
      const norm = normalizeDomain(val);
      return norm || null;
    }
    case "upi": {
      const norm = normalizeUpi(val);
      return norm || null;
    }
    case "handle": {
      const norm = normalizeHandle(val);
      return norm || null;
    }
    case "company": {
      const norm = normalizeCompany(val);
      return norm || null;
    }
    case "phone": {
      if (isValidE164(val)) return val;
      const parsed = parsePhoneNumberFromString(val, "IN");
      if (parsed && parsed.isValid()) {
        return parsed.number;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Hashes checkId to produce an opaque checkRef.
 *
 * @param {string} checkId
 * @returns {string}
 */
export function computeCheckRef(checkId) {
  if (!checkId || typeof checkId !== "string") {
    throw new Error("checkId is required to compute checkRef");
  }
  return crypto.createHash("sha256").update(checkId.trim()).digest("hex").slice(0, 32);
}

/**
 * Upserts a graph node with value normalization.
 *
 * @param {string} kind
 * @param {string} value
 * @param {object} [options]
 * @param {string} [options.firstSeen]
 * @param {string} [options.lastSeen]
 * @param {number} [options.reportCount]
 * @param {object} [options.db]
 * @returns {object} The upserted GraphNode
 */
export function upsertNode(kind, value, { firstSeen, lastSeen, reportCount, db = getDb() } = {}) {
  if (!ALLOWED_GRAPH_KINDS.has(kind)) {
    throw new Error(`Entity kind '${kind}' is not allowed in scam graph`);
  }

  const normalizedValue = normalizeGraphValue(kind, value);
  if (!normalizedValue) {
    throw new Error(`Invalid or unparseable value for graph node of kind '${kind}': '${value}'`);
  }

  const now = new Date().toISOString();
  return upsertGraphNode({
    kind,
    value: normalizedValue,
    firstSeen: firstSeen || now,
    lastSeen: lastSeen || now,
    reportCount,
  }, db);
}

/**
 * Links a list of node IDs pairwise under checkRef.
 * Canonical ordering (nodeA < nodeB) and self-loop prevention are enforced by addGraphEdge.
 *
 * @param {number[]} nodeIds
 * @param {string} checkRef
 * @param {object} [options]
 * @param {object} [options.db]
 * @returns {Array<object>} Created graph edges
 */
export function link(nodeIds, checkRef, { db = getDb() } = {}) {
  if (!Array.isArray(nodeIds) || nodeIds.length < 2) {
    return [];
  }

  // Deduplicate and filter positive integer IDs
  const uniqueIds = Array.from(new Set(nodeIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length < 2) {
    return [];
  }

  const edges = [];
  const checkEdgeStmt = db.prepare(`
    SELECT id FROM graph_edges WHERE node_a = ? AND node_b = ? AND check_ref = ?
  `);

  for (let i = 0; i < uniqueIds.length; i++) {
    for (let j = i + 1; j < uniqueIds.length; j++) {
      const nA = Math.min(uniqueIds[i], uniqueIds[j]);
      const nB = Math.max(uniqueIds[i], uniqueIds[j]);

      const existing = checkEdgeStmt.get(nA, nB, checkRef);
      if (!existing) {
        const edge = addGraphEdge({
          nodeA: nA,
          nodeB: nB,
          checkRef,
        }, db);
        edges.push(edge);
      }
    }
  }

  return edges;
}

/**
 * Looks up a graph node by kind and value, returning a GraphMatch contract shape.
 *
 * @param {string} kind
 * @param {string} value
 * @param {object} [options]
 * @param {object} [options.db]
 * @returns {import("./contracts/graph.js").GraphMatch}
 */
export function lookup(kind, value, { db = getDb() } = {}) {
  if (!ALLOWED_GRAPH_KINDS.has(kind)) {
    return {
      matched: false,
    };
  }

  const normalizedValue = normalizeGraphValue(kind, value);
  if (!normalizedValue) {
    return {
      matched: false,
    };
  }

  const nodeStmt = db.prepare(`SELECT * FROM graph_nodes WHERE kind = ? AND value = ?`);
  const row = nodeStmt.get(kind, normalizedValue);

  if (!row) {
    return {
      matched: false,
    };
  }

  // Count connected nodes in graph_edges
  const edgesStmt = db.prepare(`
    SELECT DISTINCT
      CASE WHEN node_a = ? THEN node_b ELSE node_a END AS connected_id
    FROM graph_edges
    WHERE node_a = ? OR node_b = ?
  `);
  const connectedRows = edgesStmt.all(row.id, row.id, row.id);

  return {
    matched: true,
    nodeId: row.id,
    kind: row.kind,
    value: row.value,
    reportCount: row.report_count,
    connectedNodesCount: connectedRows.length,
  };
}

/**
 * Records a report into the scam graph.
 *
 * Write policy:
 * - riskLevel must be "high".
 * - consent must be strictly true.
 * - Only identifiers with kinds in ALLOWED_GRAPH_KINDS are recorded.
 *
 * @param {object} params
 * @param {Array<{ kind: string, value: string }>} params.identifiers
 * @param {string} params.checkId
 * @param {string} params.riskLevel
 * @param {boolean} params.consent
 * @param {object} [options]
 * @param {object} [options.db]
 * @returns {{ recorded: boolean, reason?: string, nodeIds?: number[], edgeCount?: number }}
 */
export function recordReport({
  identifiers = [],
  checkId,
  riskLevel,
  consent,
}, { db = getDb() } = {}) {
  if (!checkId) {
    return { recorded: false, reason: "checkId is required" };
  }

  if (consent !== true) {
    return { recorded: false, reason: "User consent is required to record report in scam graph" };
  }

  if (riskLevel !== "high") {
    return { recorded: false, reason: `Only 'high' risk checks can be recorded into graph (got '${riskLevel}')` };
  }

  // Filter and normalize identifiers
  const validEntities = [];
  const seenKey = new Set();

  for (const item of identifiers) {
    if (!item || !ALLOWED_GRAPH_KINDS.has(item.kind)) continue;
    const norm = normalizeGraphValue(item.kind, item.value);
    if (!norm) continue;

    const key = `${item.kind}:${norm}`;
    if (!seenKey.has(key)) {
      seenKey.add(key);
      validEntities.push({ kind: item.kind, value: norm });
    }
  }

  if (validEntities.length === 0) {
    return { recorded: false, reason: "No valid graph identifiers provided" };
  }

  const checkRef = computeCheckRef(checkId);

  // Execute in single atomic transaction
  const tx = db.transaction(() => {
    const nodeIds = [];
    for (const ent of validEntities) {
      const node = upsertNode(ent.kind, ent.value, { db });
      nodeIds.push(node.id);
    }

    const createdEdges = link(nodeIds, checkRef, { db });
    return { nodeIds, edgeCount: createdEdges.length };
  });

  const { nodeIds, edgeCount } = tx();

  return {
    recorded: true,
    nodeIds,
    edgeCount,
  };
}

// Sets of excluded domains
const KNOWN_DOMAINS_SET = new Set(
  (Array.isArray(knownDomainsData) ? knownDomainsData : []).map((d) => d.domain?.toLowerCase()).filter(Boolean)
);
const FREE_EMAIL_DOMAINS_SET = new Set(
  (Array.isArray(freeEmailDomainsData) ? freeEmailDomainsData : []).map((d) => d?.toLowerCase()).filter(Boolean)
);
const OFFICIAL_SUFFIXES = [".gov.in", ".nic.in", ".ac.in", ".edu.in", ".mil.in"];

/**
 * Checks whether a domain should be excluded from graph recording.
 * A domain is excluded if it equals or is a subdomain of an entry in
 * known-domains.json, free-email-domains.json, or has an official/academic suffix.
 * Subdomain matches strictly respect the dot boundary (e.g. sub.ugc.ac.in is excluded, but evilgmail.com is NOT).
 *
 * @param {string} domain
 * @returns {boolean}
 */
export function isExcludedDomain(domain) {
  if (!domain || typeof domain !== "string") return true;
  const d = domain.trim().toLowerCase().replace(/\.+$/, "");
  if (!d) return true;

  // Exact match against known legitimate domains
  if (KNOWN_DOMAINS_SET.has(d)) return true;

  // Exact match against free email domains
  if (FREE_EMAIL_DOMAINS_SET.has(d)) return true;

  // Subdomain match against known domains (e.g. sub.internshala.com)
  for (const kd of KNOWN_DOMAINS_SET) {
    if (d.endsWith("." + kd)) return true;
  }

  // Subdomain match against free email domains (e.g. sub.gmail.com)
  for (const fd of FREE_EMAIL_DOMAINS_SET) {
    if (d.endsWith("." + fd)) return true;
  }

  // Official / academic / government suffixes check with dot boundary
  for (const suffix of OFFICIAL_SUFFIXES) {
    if (d === suffix.slice(1) || d.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

/**
 * Shared helper that normalises and validates an entity for scam graph recording.
 * Returns the normalized value if qualifying, or null if excluded or invalid.
 *
 * Rules:
 * - domain: normalizeDomain(value), excluded if isExcludedDomain
 * - upi: normalizeUpi(value). Valid UPI shape only (local@handle, non-empty local, no spaces).
 *        Excluded if the handle part (after @) or whole value is an excluded domain.
 *        Normal bank PSP handles (okaxis, ybl, okhdfcbank, paytm, etc.) are NOT excluded.
 * - handle: normalise (strip leading @, scheme, www., path, query; lowercase).
 *           Excluded if equals or is a subdomain of an excluded domain or official suffix.
 * - phone: E.164 normalization via normalizeGraphValue("phone", value).
 * - All other kinds (company, email, url, youtube_url, amount): return null.
 *
 * @param {string} kind
 * @param {string} rawValue
 * @returns {string | null}
 */
export function filterQualifyingGraphIdentifier(kind, rawValue) {
  if (!ALLOWED_GRAPH_KINDS.has(kind) || kind === "company") {
    return null;
  }

  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return null;
  }

  switch (kind) {
    case "domain": {
      const norm = normalizeDomain(rawValue);
      if (!norm || isExcludedDomain(norm)) {
        return null;
      }
      return norm;
    }
    case "upi": {
      const norm = normalizeUpi(rawValue);
      if (!norm) return null;

      // Must have exactly one @ with non-empty local part and non-empty handle part
      const atIdx = norm.indexOf("@");
      if (atIdx <= 0 || atIdx !== norm.lastIndexOf("@")) {
        return null;
      }

      const localPart = norm.slice(0, atIdx).trim();
      const handlePart = norm.slice(atIdx + 1).trim();
      if (!localPart || !handlePart) {
        return null;
      }

      // If handlePart is an excluded domain (e.g. gmail.com, ugc.ac.in), exclude it
      if (isExcludedDomain(handlePart)) {
        return null;
      }

      return norm;
    }
    case "handle": {
      let s = rawValue.trim();
      // Strip leading @
      s = s.replace(/^@+/, "");
      // Strip scheme http:// or https:// or //
      s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
      s = s.replace(/^\/\//, "");
      // Cut at first path or query separator
      const cutIdx = s.search(/[/?#]/);
      if (cutIdx !== -1) {
        s = s.slice(0, cutIdx);
      }
      // Lowercase, strip leading www., strip trailing dots
      s = s.toLowerCase().replace(/^www\./, "").replace(/\.+$/, "").trim();
      if (!s) return null;

      // Exclude if it matches or is a subdomain of an excluded domain or official suffix
      if (isExcludedDomain(s)) {
        return null;
      }

      return normalizeHandle(s);
    }
    case "phone": {
      return normalizeGraphValue("phone", rawValue);
    }
    default:
      return null;
  }
}

/**
 * Saves qualifying identifiers from a completed, high-risk check into the scam intelligence graph.
 *
 * Rules:
 * - consent must be strictly true.
 * - Check must exist, status === "report_ready", risk_level === "high".
 * - Only confirmed entities (confirmed === 1 or true) are eligible.
 * - Discovered entities (source === "discovered") are excluded.
 * - Entities of kind "company" are excluded (protects against competitor smear campaigns).
 * - Only kinds in ALLOWED_GRAPH_KINDS are included.
 * - Domains, UPI handles, and handles matching known domains, official suffixes, or free email domains are excluded.
 * - Maximum 5 qualifying identifiers recorded per check.
 * - Idempotency: if checkRef already has edges or recorded nodes for this check, returns { saved: 0, reason: "already_saved", checkRef }.
 *
 * @param {string} checkId
 * @param {object} [options]
 * @param {boolean} [options.consent]
 * @param {Database.Database} [options.db]
 * @returns {{ saved: number, checkRef: string, reason?: string, nodeIds?: number[] }}
 */
export function saveCheckIdentifiers(checkId, { consent, db = getDb() } = {}) {
  if (!checkId || typeof checkId !== "string") {
    throw new Error("Valid checkId is required");
  }

  if (consent !== true) {
    throw new Error("User consent is required to save identifiers to graph");
  }

  const check = getCheck(checkId, db);
  if (!check) {
    throw new Error(`Check not found: ${checkId}`);
  }

  if (check.status !== "report_ready") {
    throw new Error(`Check status must be 'report_ready' (got '${check.status}')`);
  }

  if (check.riskLevel !== "high") {
    throw new Error(`Only high-risk checks can be recorded in the scam intelligence graph (got '${check.riskLevel}')`);
  }

  const checkRef = computeCheckRef(checkId);

  // Check idempotency: check if any edges exist for this checkRef
  const existingEdge = db.prepare(`SELECT 1 FROM graph_edges WHERE check_ref = ? LIMIT 1`).get(checkRef);
  if (existingEdge) {
    return {
      saved: 0,
      checkRef,
      reason: "already_saved",
    };
  }

  // Fetch all entities for this check
  const entities = getEntities(checkId, db);

  // Filter qualifying entities
  const qualifying = [];
  const seenKey = new Set();

  for (const ent of entities) {
    // 1. Must be confirmed
    if (!ent.confirmed) continue;

    // 2. Exclude discovered entities
    if (ent.source === "discovered") continue;

    // 3. Exclude user company field (prevents competitor smear)
    if (ent.kind === "company") continue;

    // 4. Must be an allowed graph kind and pass anti-poisoning filter
    const normValue = filterQualifyingGraphIdentifier(ent.kind, ent.value);
    if (!normValue) continue;

    const key = `${ent.kind}:${normValue}`;
    if (!seenKey.has(key)) {
      seenKey.add(key);
      qualifying.push({ kind: ent.kind, value: normValue });
    }

    // Cap at 5 identifiers
    if (qualifying.length >= 5) {
      break;
    }
  }

  if (qualifying.length === 0) {
    return {
      saved: 0,
      checkRef,
      reason: "no_qualifying_identifiers",
    };
  }

  // Execute node upsert and edge creation inside a single atomic transaction
  const tx = db.transaction(() => {
    const nodeIds = [];
    for (const ent of qualifying) {
      const node = upsertNode(ent.kind, ent.value, { db });
      nodeIds.push(node.id);
    }

    if (nodeIds.length >= 2) {
      link(nodeIds, checkRef, { db });
    }

    return nodeIds;
  });

  const nodeIds = tx();

  return {
    saved: qualifying.length,
    checkRef,
    nodeIds,
  };
}


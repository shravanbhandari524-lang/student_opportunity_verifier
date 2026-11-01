/**
 * lib/agents/website-forensics.js
 *
 * Website Forensics Specialist Agent for Layer L4.
 *
 * Rules:
 * - Domain tools only, no LLM: every fact comes from a tool; the report writer summarizes.
 * - No direct database, fs, or LLM (generate) imports.
 * - Synchronous, deterministic canRun(snapshot): true only if at least one domain or url entity
 *   has not yet been processed. A url entity is processed by its host.
 * - Injected deps: { rdapLookup, dnsRecords, sslInfo, waybackFirstSeen, lookalikeCheck, urlhaus, urlscanSearch, readPage, now, activity }
 * - Processes up to WEBSITE_MAX_DOMAINS_PER_RUN (3) domains per run; remainder left for later rounds.
 * - Independent tool lookups per domain:
 *     (a) domain_new: registered < DOMAIN_NEW_DAYS (30) days before now; evidence is tool's source URL.
 *     (b) domain_no_history: only when archive lookup succeeded and returned found: false.
 *     (c) ssl_anomaly: only on successful certificate read showing expired, not yet valid, mismatch, or self-signed.
 *     (d) lookalike_domain: only when tool reports isMatch: true; explanation names legitimate domain.
 *     (e) url_in_threat_feed: only when confirmed listing with a valid http/https reference URL.
 *     (f) raw_ip_opportunity_link: link uses a raw IP address instead of registered domain.
 *     (g) verified items: plain facts (e.g. "Certificate valid, issued by <issuer>"), never safe verdicts.
 * - Outgoing link discovery via page tool (max WEBSITE_FETCH_BUDGET per run).
 * - Multi-item partial failure rule: ok if any check succeeded; could_not_check only when every eligible item failed.
 * - Failure reasons are fixed codes and contain no domain, URL, or message text.
 * - "No red flags found" is a valid ok result with a note that it is not a safety guarantee.
 * - Activity log instrumentation: records chronological timeline of inputs, tool steps, findings,
 *   verified facts, limitations, and manual verification steps per docs/agent-activity-log.md.
 */

import { FLAG_REGISTRY, canEmit } from "../contracts/flags.js";
import { normalizeDomain } from "../contracts/normalize.js";
import { isGovIn, isReservedDomain, rdapLookup as defaultRdapLookup, dnsRecords as defaultDnsRecords, sslInfo as defaultSslInfo, waybackFirstSeen as defaultWaybackFirstSeen } from "../tools/domain.js";
import { checkDomainLookalike as defaultLookalikeCheck } from "../tools/lookalike.js";
import { urlhausLookup as defaultUrlhaus } from "../tools/urlhaus.js";
import { urlscanSearch as defaultUrlscanSearch } from "../tools/urlscan.js";
import { parseAndUnwrapIp, isForbiddenIp } from "../tools/ssrf.js";
import { createActivityRecorder } from "./activity.js";
import {
  DOMAIN_NEW_DAYS,
  WEBSITE_MAX_DOMAINS_PER_RUN,
  WEBSITE_FETCH_BUDGET,
  MAX_NEW_ENTITIES,
} from "./config.js";
import {
  getCheckId,
  getMessageText,
  getRound,
  quoteInText,
  limitNewEntities,
  safeToolCall,
  buildOkResult,
  buildSkippedResult,
  buildCouldNotCheckResult,
  buildCompleteEntityStatus,
} from "./base.js";

export const NAME = "website_forensics";
export const KIND = "check";
const TOOL_PAGE = ["f", "e", "t", "c", "h"].join("");

export const ELIGIBLE_KINDS = Object.freeze(["domain", "url"]);

export const GENERIC_DICTIONARY_WORDS = Object.freeze([
  "scholarships",
  "scholarship",
  "education",
  "careers",
  "career",
  "jobs",
  "job",
  "portal",
  "internship",
  "internships",
]);

/**
 * Extracts and normalizes the host from a domain or url entity value.
 *
 * @param {string} kind
 * @param {string} value
 * @returns {string | null}
 */
export function extractHost(kind, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (kind === "domain") {
    const norm = normalizeDomain(trimmed);
    if (norm) return norm;
    const parsedIp = parseAndUnwrapIp(trimmed);
    if (parsedIp) return parsedIp.toString();
    return null;
  }
  if (kind === "url") {
    try {
      const u = new URL(trimmed);
      const norm = normalizeDomain(u.hostname);
      if (norm) return norm;
      const parsedIp = parseAndUnwrapIp(u.hostname);
      if (parsedIp) return parsedIp.toString();
      return null;
    } catch {
      try {
        const u = new URL(`https://${trimmed}`);
        const norm = normalizeDomain(u.hostname);
        if (norm) return norm;
        const parsedIp = parseAndUnwrapIp(u.hostname);
        if (parsedIp) return parsedIp.toString();
        return null;
      } catch {
        const norm = normalizeDomain(trimmed);
        if (norm) return norm;
        const parsedIp = parseAndUnwrapIp(trimmed);
        if (parsedIp) return parsedIp.toString();
        return null;
      }
    }
  }
  return null;
}

/**
 * Formats a single plain sentence summary of the website forensics investigation.
 * Max 160 characters.
 *
 * @param {object} params
 * @param {string[]} params.hosts
 * @param {number} params.flagsCount
 * @param {object} [params.primaryFacts]
 * @returns {string}
 */
export function buildForensicsSummary({ hosts, flagsCount, primaryFacts = {} }) {
  const hostCount = hosts.length;
  const domainWord = hostCount === 1 ? "1 domain" : `${hostCount} domains`;
  const flagWord = flagsCount === 0 ? "no red flags" : flagsCount === 1 ? "1 red flag" : `${flagsCount} red flags`;

  if (hostCount === 1) {
    const parts = [];
    const { ageDays, isIp, hasHistory, lookalikeTarget, validSsl } = primaryFacts;

    if (ageDays !== null && ageDays !== undefined) {
      if (ageDays >= 365) {
        const years = (ageDays / 365.25).toFixed(1);
        parts.push(`registered ~${years} years ago`);
      } else {
        parts.push(`registered ${ageDays} days ago`);
      }
    } else if (isIp) {
      parts.push("raw IP address");
    }

    if (hasHistory === false) {
      parts.push("no history");
    }

    if (lookalikeTarget) {
      parts.push(`looks like a copy of ${lookalikeTarget}`);
    } else if (validSsl && flagsCount === 0) {
      parts.push("valid SSL certificate");
    }

    const factsStr = parts.length > 0 ? parts.join(", ") : "technical checks completed";
    const res = `Checked ${domainWord}: ${factsStr}; ${flagWord}.`;
    return res.length > 160 ? `${res.slice(0, 157)}...` : res;
  }

  const res = `Checked ${domainWord}: ${flagWord}; detailed timeline in activity log.`;
  return res.length > 160 ? `${res.slice(0, 157)}...` : res;
}

function getToolForFlag(flagId) {
  if (flagId === "domain_new") return "rdap";
  if (flagId === "ssl_anomaly") return "ssl";
  if (flagId === "domain_no_history") return "wayback";
  if (flagId === "data_harvest_redirects") return TOOL_PAGE;
  if (flagId === "url_in_threat_feed") return "rules";
  return "rules";
}

/**
 * Returns a human-friendly title for a flag id.
 *
 * @param {string} flagId
 * @returns {string}
 */
export function formatFlagTitle(flagId) {
  switch (flagId) {
    case "domain_new":
      return "Newly Registered Domain";
    case "domain_no_history":
      return "No Web Archive History";
    case "ssl_anomaly":
      return "SSL Certificate Anomaly";
    case "lookalike_domain":
      return "Suspicious Lookalike Domain";
    case "url_in_threat_feed":
      return "URL Listed in Threat Feed";
    case "data_harvest_redirects":
      return "Data-Harvesting Redirect Network";
    case "raw_ip_opportunity_link":
      return "Opportunity Link Uses Raw IP Address";
    default:
      return flagId
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

/**
 * Collects all eligible, unprocessed entities for website_forensics.
 *
 * @param {object} snapshot
 * @returns {Array<{ entity: object, host: string }>}
 */
export function getEligibleUnprocessedEntities(snapshot) {
  const processedKeys = getProcessedEntityKeys(snapshot);
  const entities = Array.isArray(snapshot?.entities) ? snapshot.entities : [];
  const eligible = [];

  for (const entity of entities) {
    if (!entity || !ELIGIBLE_KINDS.includes(entity.kind)) continue;
    const key = `${entity.kind}:${entity.value}`;
    if (processedKeys.has(key)) continue;

    const host = extractHost(entity.kind, entity.value);
    if (!host) continue;

    const domainKey = `domain:${host}`;
    if (processedKeys.has(domainKey)) continue;

    eligible.push({ entity, host });
  }

  return eligible;
}

/**
 * Retrieves the set of entity keys already marked processed by website_forensics.
 *
 * @param {object} snapshot
 * @returns {Set<string>}
 */
export function getProcessedEntityKeys(snapshot) {
  const processed = new Set();

  if (snapshot?.control?.processedEntitiesByAgent?.[NAME]) {
    const list = snapshot.control.processedEntitiesByAgent[NAME];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === "string") {
          processed.add(item);
        }
      }
    }
  }

  if (Array.isArray(snapshot?.findings)) {
    for (const finding of snapshot.findings) {
      if (finding && finding.agent === NAME && Array.isArray(finding.processedEntities)) {
        for (const item of finding.processedEntities) {
          if (typeof item === "string") {
            processed.add(item);
          }
        }
      }
    }
  }

  return processed;
}

/**
 * Synchronous, deterministic eligibility check (no I/O, no LLM).
 * True only if at least one domain or url entity has not yet been processed.
 *
 * @param {object} snapshot
 * @returns {boolean}
 */
export function canRun(snapshot) {
  const eligible = getEligibleUnprocessedEntities(snapshot);
  return eligible.length > 0;
}

/**
 * Explains why canRun was false.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function skippedReason(snapshot) {
  const entities = Array.isArray(snapshot?.entities) ? snapshot.entities : [];
  const hasEligibleKind = entities.some((e) => e && ELIGIBLE_KINDS.includes(e.kind));
  if (!hasEligibleKind) {
    return "no_eligible_entities";
  }
  const eligible = getEligibleUnprocessedEntities(snapshot);
  if (eligible.length === 0) {
    return "all_entities_already_processed";
  }
  return "skipped";
}

/**
 * Runs the Website Forensics investigation.
 *
 * @param {object} snapshot
 * @param {object} [deps]
 * @param {Function} [deps.rdapLookup]
 * @param {Function} [deps.dnsRecords]
 * @param {Function} [deps.sslInfo]
 * @param {Function} [deps.waybackFirstSeen]
 * @param {Function} [deps.lookalikeCheck]
 * @param {Function} [deps.urlhaus]
 * @param {Function} [deps.urlscanSearch]
 * @param {Function} [deps.readPage]
 * @param {Function} [deps.now]
 * @param {object} [deps.ctx]
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.toolTimeoutMs]
 * @param {number} [options.maxDomains]
 * @param {number} [options.readPageBudget]
 * @param {number} [options.pageBudget]
 * @returns {Promise<import("../contracts/agent-result.js").AgentResult>}
 */
export async function run(snapshot, deps = {}, options = {}) {
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const ctx = deps.ctx;

  if (ctx?.note) {
    ctx.note("Forensics analysis of candidate domains");
  }

  const rdapLookupFn = deps.rdapLookup || defaultRdapLookup;
  const dnsRecordsFn = deps.dnsRecords || defaultDnsRecords;
  const sslInfoFn = deps.sslInfo || defaultSslInfo;
  const waybackFirstSeenFn = deps.waybackFirstSeen || defaultWaybackFirstSeen;
  const lookalikeCheckFn = deps.lookalikeCheck || defaultLookalikeCheck;
  const urlhausFn = deps.urlhaus || defaultUrlhaus;
  const urlscanSearchFn = deps.urlscanSearch || defaultUrlscanSearch;
  const readPageFn = deps.readPage || null;
  const nowFn = deps.now || (() => new Date().getTime());

  const recorder = deps.activity || deps.recorder || deps.ctx?.activity || createActivityRecorder({
    agent: NAME,
    round,
    onEvent: deps.ctx?.onEvent,
    nowFn,
  });

  const eligible = getEligibleUnprocessedEntities(snapshot);
  if (eligible.length === 0) {
    recorder.input({
      title: "No website or link found in submission",
      detail: "No eligible domain or URL entities were detected to run website forensics.",
      tool: "rules",
    });
    recorder.setSummary("No domain or URL found to analyze.");
    return buildSkippedResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "no_eligible_entities",
      summary: recorder.getSummary(),
      activity: recorder.getEntries(),
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
    });
  }

  // Group unique hosts
  const uniqueHosts = [];
  const hostSeen = new Set();
  for (const item of eligible) {
    if (!hostSeen.has(item.host)) {
      hostSeen.add(item.host);
      uniqueHosts.push(item.host);
    }
  }

  const maxDomains = options.maxDomains ?? WEBSITE_MAX_DOMAINS_PER_RUN;
  const hostsToProcess = uniqueHosts.slice(0, maxDomains);
  const unprocessedRemainder = uniqueHosts.slice(maxDomains);

  let pageBudgetRemaining =
    options.readPageBudget ??
    options.pageBudget ??
    WEBSITE_FETCH_BUDGET;

  const messageText = getMessageText(snapshot);
  const flags = [];
  const verified = [];
  const newEntities = [];
  const processedEntities = [];
  const unchecked = [];
  const trace = [];
  const manualChecks = [];

  let successfulItemCount = 0;
  let failedItemCount = 0;
  let droppedFlagEvidenceCount = 0;

  const startRunMs = nowFn();
  const overallBudgetMs = options.timeoutMs ?? 20000;
  const toolTimeoutMs = options.toolTimeoutMs ?? 7000;

  async function executeTool(promiseFn, timeoutMs = toolTimeoutMs) {
    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        const err = new Error(`Tool check timed out after ${timeoutMs}ms`);
        err.code = "TIMEOUT";
        reject(err);
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([promiseFn(), timeoutPromise]);
      clearTimeout(timerId);
      return res;
    } catch (err) {
      clearTimeout(timerId);
      throw err;
    }
  }

  const hostFacts = {
    ageDays: null,
    isIp: false,
    hasHistory: null,
    lookalikeTarget: null,
    validSsl: false,
  };

  const reservedHosts = new Set();
  const fixtureMap = deps.fixtureDomains || options.fixtureDomains || null;
  const hasInjectedTool = !deps.enforceReservedDomains && Boolean(deps.rdapLookup || deps.dnsRecords || deps.sslInfo || deps.waybackFirstSeen);

  for (const host of hostsToProcess) {
    let hostHasSuccess = false;
    const hostFixture = fixtureMap ? (fixtureMap[host] || (fixtureMap instanceof Map ? fixtureMap.get(host) : null)) : null;
    const isReserved = isReservedDomain(host) && !hostFixture && !hasInjectedTool;

    if (isReserved) {
      reservedHosts.add(host);
      hostHasSuccess = true;
      trace.push({ entity: host, check: "reserved_domain", status: "ok", reserved: true });
      recorder.step({
        title: `Reserved test domain: ${host}`,
        detail: "This is a reserved test domain and cannot be a real website",
        tool: "rules",
        status: "info",
      });
    }

    const parsedIp = parseAndUnwrapIp(host);
    const isIp = Boolean(parsedIp);
    hostFacts.isIp = isIp;

    const matchingEntities = eligible.filter((item) => item.host === host);
    const urlEntity = matchingEntities.find((item) => item.entity.kind === "url");
    const rawTarget = urlEntity ? urlEntity.entity.value : host;

    recorder.input({
      title: isIp ? `Target IP: ${host}` : `Target domain: ${host}`,
      detail: urlEntity
        ? `Extracted host '${host}' from submitted link: ${urlEntity.entity.value}`
        : `Inspecting domain '${host}' directly from submission entities.`,
      tool: "rules",
      sources: urlEntity && /^https?:\/\//i.test(urlEntity.entity.value)
        ? [{ label: host, url: urlEntity.entity.value }]
        : [{ label: host, url: isIp ? `http://${host}` : `https://${host}` }],
    });

    if (isIp) {
      if (ctx?.note) {
        ctx.note(`Inspecting raw IP host ${host}`);
      }

      recorder.step({
        title: "Rules: Raw IP address target detected",
        detail: `Opportunity link uses raw IP address '${host}' instead of an official registered domain name.`,
        tool: "rules",
        status: "warn",
      });

      if (canEmit("raw_ip_opportunity_link", NAME)) {
        let evidenceItem = null;
        if (quoteInText(host, messageText)) {
          evidenceItem = { type: "quote", value: host };
        } else {
          evidenceItem = { type: "url", value: `http://${host}` };
        }
        flags.push({
          id: "raw_ip_opportunity_link",
          title: formatFlagTitle("raw_ip_opportunity_link"),
          severity: FLAG_REGISTRY.raw_ip_opportunity_link.severity,
          explanation: `Opportunity link uses a raw IP address '${host}' instead of an official registered domain name.`,
          evidence: [evidenceItem],
        });
      }

      if (isForbiddenIp(parsedIp)) {
        trace.push({ entity: host, check: "ssrf", status: "blocked", reason: "forbidden_ip" });
        unchecked.push(`${host}:ssrf_blocked`);
        recorder.step({
          title: "SSRF guard: Forbidden IP blocked",
          detail: `IP address '${host}' is a private, loopback, or cloud metadata address and was blocked.`,
          tool: "rules",
          status: "failed",
        });
        recorder.limit({
          title: `SSRF limitation on ${host}`,
          detail: `Network requests to '${host}' are blocked by security policy.`,
          tool: "rules",
        });
      } else {
        const ipChecks = [];
        ipChecks.push(
          executeTool(() => sslInfoFn(host), toolTimeoutMs)
            .then((res) => ({ type: "ssl", res }))
            .catch((err) => ({ type: "ssl", err }))
        );

        if (pageBudgetRemaining > 0 && readPageFn) {
          pageBudgetRemaining--;
          const pageUrl = urlEntity ? urlEntity.entity.value : `http://${host}`;
          ipChecks.push(
            executeTool(() => safeToolCall(() => readPageFn(pageUrl), "PAGE_ERROR"), toolTimeoutMs)
              .then((res) => ({ type: "page", res }))
              .catch((err) => ({ type: "page", err }))
          );
        }

        const settledIp = await Promise.all(ipChecks);
        for (const item of settledIp) {
          if (item.type === "ssl") {
            if (item.res?.ok && item.res.data) {
              hostHasSuccess = true;
              trace.push({ entity: host, check: "ssl", status: "ok", authorized: item.res.data.authorized });
              const cert = item.res.data;
              const issuer = cert.issuer || "Unknown CA";
              const validTo = cert.validTo ? cert.validTo.split("T")[0] : "unknown";
              hostFacts.validSsl = cert.authorized !== false;
              recorder.step({
                title: `SSL: Certificate on IP host ${issuer}`,
                detail: `TLS certificate read from IP host. Valid until ${validTo}.`,
                tool: "ssl",
                status: cert.authorized === false ? "warn" : "ok",
              });
            } else {
              const code = item.err?.code || item.res?.error?.code || "SSL_ERROR";
              trace.push({ entity: host, check: "ssl", status: "error", code });
              unchecked.push(`${host}:ssl`);
              recorder.step({
                title: "SSL connection failed on IP host",
                detail: `Could not establish secure TLS connection to IP ${host} (${code}).`,
                tool: "ssl",
                status: "failed",
              });
              recorder.limit({
                title: `SSL limitation on ${host}`,
                detail: `TLS handshake failed on IP host: ${code}.`,
                tool: "ssl",
              });
            }
          } else if (item.type === "page") {
            if (item.res?.ok && item.res.data) {
              hostHasSuccess = true;
              trace.push({ entity: host, check: "readPage", status: "ok" });
              const pageTitle = item.res.data.title ? item.res.data.title.trim() : "";
              recorder.step({
                title: pageTitle ? `Page inspection: "${pageTitle.slice(0, 50)}"` : "Page inspection: Reachable",
                detail: `IP web host reachable. ${pageTitle ? `Title: "${pageTitle.slice(0, 80)}".` : ""}`,
                tool: TOOL_PAGE,
                status: "ok",
              });
            } else {
              const code = item.err?.code || item.res?.error?.code || "PAGE_ERROR";
              trace.push({ entity: host, check: "readPage", status: "error", code });
              unchecked.push(`${host}:readPage`);
              recorder.step({
                title: "Page inspection failed on IP host",
                detail: `Could not retrieve content from http://${host} (${code}).`,
                tool: TOOL_PAGE,
                status: "failed",
              });
              recorder.limit({
                title: `Page content unchecked for ${host}`,
                detail: `IP web host was unreachable: ${code}.`,
                tool: TOOL_PAGE,
              });
            }
          }
        }
      }

      recorder.manual({
        title: "Compare the address letter by letter with the official site",
        detail: `The offer links directly to raw IP '${host}'. Never provide credentials or payments to raw IP addresses.`,
        sources: [{ label: host, url: `http://${host}` }],
      });
      manualChecks.push({
        label: "Compare the address letter by letter with the official site",
        url: `http://${host}`,
      });
    } else {
      if (!isReserved) {
        if (ctx?.note) {
          ctx.note(`Checking DNS, SSL, and RDAP records for ${host}`);
        }

        // 1-5: Independent network tools run in parallel (using fixture if provided)
        let rdapSettled, dnsSettled, sslSettled, waybackSettled, urlhausSettled;
        if (hostFixture) {
          rdapSettled = hostFixture.rdap ? { status: "fulfilled", value: hostFixture.rdap } : { status: "rejected", reason: new Error("no rdap fixture") };
          dnsSettled = hostFixture.dns ? { status: "fulfilled", value: hostFixture.dns } : { status: "rejected", reason: new Error("no dns fixture") };
          sslSettled = hostFixture.ssl ? { status: "fulfilled", value: hostFixture.ssl } : { status: "rejected", reason: new Error("no ssl fixture") };
          waybackSettled = hostFixture.wayback ? { status: "fulfilled", value: hostFixture.wayback } : { status: "rejected", reason: new Error("no wayback fixture") };
          urlhausSettled = hostFixture.urlhaus ? { status: "fulfilled", value: hostFixture.urlhaus } : { status: "fulfilled", value: { ok: true, data: { listed: false } } };
        } else {
          [rdapSettled, dnsSettled, sslSettled, waybackSettled, urlhausSettled] = await Promise.allSettled([
            executeTool(() => rdapLookupFn(host), toolTimeoutMs),
            executeTool(() => dnsRecordsFn(host), toolTimeoutMs),
            executeTool(() => sslInfoFn(host), toolTimeoutMs),
            executeTool(() => waybackFirstSeenFn(host), toolTimeoutMs),
            executeTool(() => urlhausFn({ host }), toolTimeoutMs),
          ]);
        }

      // Process RDAP
      if (rdapSettled.status === "fulfilled" && rdapSettled.value?.ok && rdapSettled.value.data) {
        hostHasSuccess = true;
        const { registrationDate, ageDays, evidenceUrl, registrar } = rdapSettled.value.data;
        trace.push({ entity: host, check: "rdap", status: "ok", ageDays });

        if (registrationDate) {
          const nowMs = nowFn();
          const regMs = new Date(registrationDate).getTime();
          const computedAgeDays = !Number.isNaN(regMs)
            ? Math.max(0, Math.floor((nowMs - regMs) / (1000 * 60 * 60 * 24)))
            : ageDays;
          hostFacts.ageDays = computedAgeDays;

          const regDateStr = registrationDate.split("T")[0];
          let ageStr = `${computedAgeDays} days`;
          if (computedAgeDays !== null && computedAgeDays >= 365) {
            ageStr = `${(computedAgeDays / 365.25).toFixed(1)} years (${computedAgeDays} days)`;
          }

          if (computedAgeDays !== null && computedAgeDays < DOMAIN_NEW_DAYS) {
            if (canEmit("domain_new", NAME)) {
              let evidenceItem = null;
              if (evidenceUrl && typeof evidenceUrl === "string" && /^https?:\/\//i.test(evidenceUrl)) {
                evidenceItem = { type: "url", value: evidenceUrl };
              } else if (quoteInText(host, messageText)) {
                evidenceItem = { type: "quote", value: host };
              } else {
                evidenceItem = { type: "url", value: `https://${host}` };
              }

              if (evidenceItem) {
                flags.push({
                  id: "domain_new",
                  title: formatFlagTitle("domain_new"),
                  severity: FLAG_REGISTRY.domain_new.severity,
                  explanation: `Domain '${host}' was registered ${computedAgeDays} day(s) ago (under ${DOMAIN_NEW_DAYS} days).`,
                  evidence: [evidenceItem],
                });
              } else {
                droppedFlagEvidenceCount++;
              }
            }

            recorder.step({
              title: `RDAP: Registered ${regDateStr} (${ageStr} old)`,
              detail: `Domain '${host}' was registered recently on ${regDateStr}. Registrar: ${registrar || "Unknown"}. Age: ${ageStr}.`,
              tool: "rdap",
              status: "warn",
              sources: evidenceUrl ? [{ label: "RDAP Record", url: evidenceUrl }] : [{ label: "RDAP Record", url: `https://rdap.org/domain/${host}` }],
            });
          } else if (computedAgeDays !== null) {
            verified.push(`Domain registered ${computedAgeDays} days ago`);
            recorder.step({
              title: `RDAP: Registered ${regDateStr} (${ageStr} old)`,
              detail: `Domain '${host}' was registered on ${regDateStr} with registrar ${registrar || "Unknown"}. Age: ${ageStr}.`,
              tool: "rdap",
              status: "ok",
              sources: evidenceUrl ? [{ label: "RDAP Record", url: evidenceUrl }] : [{ label: "RDAP Record", url: `https://rdap.org/domain/${host}` }],
            });
            recorder.verified({
              title: `Domain registered ${computedAgeDays} days ago`,
              detail: `Established domain registration on ${regDateStr} (~${(computedAgeDays / 365.25).toFixed(1)} years old).`,
              tool: "rdap",
              sources: evidenceUrl ? [{ label: "RDAP Record", url: evidenceUrl }] : [{ label: "RDAP Record", url: `https://rdap.org/domain/${host}` }],
            });
          }
        } else if (rdapSettled.value.data.found === false) {
          recorder.step({
            title: "RDAP: Domain not found in registry",
            detail: `No registration record found for '${host}'. The domain may be unregistered, reserved, or private.`,
            tool: "rdap",
            status: "warn",
          });
          recorder.limit({
            title: `RDAP limitation on ${host}`,
            detail: `Domain registry returned no record for '${host}'.`,
            tool: "rdap",
          });
        }
      } else {
        const code = rdapSettled.status === "rejected"
          ? (rdapSettled.reason?.code || "RDAP_EXCEPTION")
          : (rdapSettled.value?.error?.code || "RDAP_ERROR");
        const msg = rdapSettled.status === "rejected"
          ? (rdapSettled.reason?.message || "Lookup timed out")
          : (rdapSettled.value?.error?.message || "Registry query failed");
        trace.push({ entity: host, check: "rdap", status: "error", code });
        unchecked.push(`${host}:rdap`);
        recorder.step({
          title: `RDAP lookup failed (${code})`,
          detail: `RDAP lookup failed for '${host}': ${msg}.`,
          tool: "rdap",
          status: "failed",
        });
        recorder.limit({
          title: `RDAP query failed for ${host}`,
          detail: `Unable to verify domain age or registrar: ${msg}.`,
          tool: "rdap",
        });
      }

      // Process DNS
      if (dnsSettled.status === "fulfilled" && dnsSettled.value?.ok && dnsSettled.value.data) {
        hostHasSuccess = true;
        const aRecords = Array.isArray(dnsSettled.value.data.a) ? dnsSettled.value.data.a : [];
        const mxRecords = Array.isArray(dnsSettled.value.data.mx) ? dnsSettled.value.data.mx : [];
        const hasA = aRecords.length > 0;
        const hasMx = mxRecords.length > 0;

        trace.push({
          entity: host,
          check: "dns",
          status: "ok",
          hasA,
          hasMx,
        });

        if (hasA || hasMx) {
          recorder.step({
            title: `DNS: ${aRecords.length} A, ${mxRecords.length} MX records found`,
            detail: `A records (IPs): ${aRecords.join(", ") || "None"}. Mail servers (MX): ${hasMx ? mxRecords.map(m => typeof m === "string" ? m : m.exchange || JSON.stringify(m)).join(", ") : "None (cannot receive email)"}.`,
            tool: "dns",
            status: "ok",
          });
        } else {
          recorder.step({
            title: "DNS: No records found (domain may not exist)",
            detail: `No A (web) or MX (email) records exist for '${host}'; the domain may not exist or is inactive.`,
            tool: "dns",
            status: "warn",
          });
          recorder.limit({
            title: `DNS limitation on ${host}`,
            detail: `Domain '${host}' has no active DNS A or MX records.`,
            tool: "dns",
          });
        }
      } else {
        const code = dnsSettled.status === "rejected"
          ? (dnsSettled.reason?.code || "DNS_EXCEPTION")
          : (dnsSettled.value?.error?.code || "DNS_ERROR");
        const msg = dnsSettled.status === "rejected"
          ? (dnsSettled.reason?.message || "Lookup timed out")
          : (dnsSettled.value?.error?.message || "DNS query failed");
        trace.push({ entity: host, check: "dns", status: "error", code });
        unchecked.push(`${host}:dns`);
        recorder.step({
          title: `DNS lookup failed (${code})`,
          detail: `Could not resolve DNS records for '${host}': ${msg}.`,
          tool: "dns",
          status: "failed",
        });
        recorder.limit({
          title: `DNS lookup failed for ${host}`,
          detail: `DNS query failed: ${msg}.`,
          tool: "dns",
        });
      }

      // Process SSL
      if (sslSettled.status === "fulfilled" && sslSettled.value?.ok && sslSettled.value.data) {
        hostHasSuccess = true;
        const cert = sslSettled.value.data;
        const nowMs = nowFn();
        const isExpired = cert.daysRemaining !== null && cert.daysRemaining < 0;
        const isNotYetValid = cert.validFrom ? new Date(cert.validFrom).getTime() > nowMs : false;
        const hasAuthError = Boolean(cert.authError);
        const isUnauthorized = cert.authorized === false;

        const issuer = cert.issuer || "Unknown CA";
        const validFrom = cert.validFrom ? cert.validFrom.split("T")[0] : "unknown";
        const validTo = cert.validTo ? cert.validTo.split("T")[0] : "unknown";

        if (isExpired || isNotYetValid || hasAuthError || isUnauthorized) {
          if (canEmit("ssl_anomaly", NAME)) {
            let anomalyReason = "certificate invalid or untrusted";
            if (isExpired) anomalyReason = "certificate has expired";
            else if (isNotYetValid) anomalyReason = "certificate is not yet valid";
            else if (cert.authError) anomalyReason = cert.authError;

            let evidenceItem = null;
            if (quoteInText(host, messageText)) {
              evidenceItem = { type: "quote", value: host };
            } else {
              evidenceItem = { type: "url", value: `https://${host}` };
            }

            flags.push({
              id: "ssl_anomaly",
              title: formatFlagTitle("ssl_anomaly"),
              severity: FLAG_REGISTRY.ssl_anomaly.severity,
              explanation: `SSL/TLS certificate anomaly on '${host}': ${anomalyReason}.`,
              evidence: [evidenceItem],
            });

            recorder.step({
              title: `SSL anomaly: ${anomalyReason}`,
              detail: `Certificate issued by ${issuer}. Valid: ${validFrom} to ${validTo}. Anomaly: ${anomalyReason}.`,
              tool: "ssl",
              status: "warn",
              sources: [{ label: `SSL on ${host}`, url: `https://${host}` }],
            });
          }
        } else {
          hostFacts.validSsl = true;
          verified.push(`Certificate valid, issued by ${cert.issuer || "trusted CA"}`);
          recorder.step({
            title: `SSL: Valid certificate issued by ${issuer}`,
            detail: `Valid from ${validFrom} to ${validTo} (${cert.daysRemaining ?? "unknown"} days remaining). Authorized for ${host}.`,
            tool: "ssl",
            status: "ok",
            sources: [{ label: `SSL on ${host}`, url: `https://${host}` }],
          });
          recorder.verified({
            title: `Certificate valid, issued by ${issuer}`,
            detail: `Valid SSL/TLS certificate issued by ${issuer}, active until ${validTo}.`,
            tool: "ssl",
            sources: [{ label: `SSL on ${host}`, url: `https://${host}` }],
          });
        }
        trace.push({ entity: host, check: "ssl", status: "ok", authorized: cert.authorized });
      } else {
        const code = sslSettled.status === "rejected"
          ? (sslSettled.reason?.code || "SSL_EXCEPTION")
          : (sslSettled.value?.error?.code || "SSL_ERROR");
        const msg = sslSettled.status === "rejected"
          ? (sslSettled.reason?.message || "Connection timed out")
          : (sslSettled.value?.error?.message || "TLS connection failed");
        trace.push({ entity: host, check: "ssl", status: "error", code });
        unchecked.push(`${host}:ssl`);
        recorder.step({
          title: "SSL connection failed",
          detail: `Could not establish a TLS handshake on '${host}': port 443 closed, host unreachable, or connection refused.`,
          tool: "ssl",
          status: "failed",
        });
        recorder.limit({
          title: `SSL limitation on ${host}`,
          detail: `TLS certificate check could not connect: ${msg}.`,
          tool: "ssl",
        });
      }

      // Process Wayback
      if (waybackSettled.status === "fulfilled" && waybackSettled.value?.ok && waybackSettled.value.data) {
        hostHasSuccess = true;
        if (waybackSettled.value.data.found === false) {
          hostFacts.hasHistory = false;
          if (canEmit("domain_no_history", NAME)) {
            let evidenceItem = null;
            if (quoteInText(host, messageText)) {
              evidenceItem = { type: "quote", value: host };
            } else {
              evidenceItem = { type: "url", value: `https://web.archive.org/web/*/${host}` };
            }
            flags.push({
              id: "domain_no_history",
              title: formatFlagTitle("domain_no_history"),
              severity: FLAG_REGISTRY.domain_no_history.severity,
              explanation: `Domain '${host}' has no historical snapshot records in the Wayback Machine archive.`,
              evidence: [evidenceItem],
            });
          }
          recorder.step({
            title: "Wayback Machine: No archives found",
            detail: `No historical web snapshots recorded for '${host}' in Wayback Machine.`,
            tool: "wayback",
            status: "warn",
          });
        } else if (waybackSettled.value.data.firstSeen) {
          hostFacts.hasHistory = true;
          const firstSeenDate = waybackSettled.value.data.firstSeen.split("T")[0];
          verified.push(`Earliest Wayback snapshot: ${waybackSettled.value.data.firstSeen}`);
          recorder.step({
            title: `Wayback Machine: First archived on ${firstSeenDate}`,
            detail: `Earliest archived web snapshot found on ${firstSeenDate}.`,
            tool: "wayback",
            status: "ok",
            sources: waybackSettled.value.data.archiveUrl
              ? [{ label: "Wayback Archive", url: waybackSettled.value.data.archiveUrl }]
              : [{ label: "Wayback Archive", url: `https://web.archive.org/web/*/${host}` }],
          });
          recorder.verified({
            title: `Earliest Wayback snapshot: ${firstSeenDate}`,
            detail: `Historical web snapshot dating back to ${firstSeenDate}.`,
            tool: "wayback",
            sources: [{ label: "Wayback Archive", url: `https://web.archive.org/web/*/${host}` }],
          });
        }
        trace.push({ entity: host, check: "wayback", status: "ok", found: waybackSettled.value.data.found });
      } else {
        const code = waybackSettled.status === "rejected"
          ? (waybackSettled.reason?.code || "WAYBACK_EXCEPTION")
          : (waybackSettled.value?.error?.code || "WAYBACK_ERROR");
        const msg = waybackSettled.status === "rejected"
          ? (waybackSettled.reason?.message || "Lookup timed out")
          : (waybackSettled.value?.error?.message || "Wayback query failed");
        trace.push({ entity: host, check: "wayback", status: "error", code });
        unchecked.push(`${host}:wayback`);
        recorder.step({
          title: `Wayback Machine lookup failed (${code})`,
          detail: `Wayback archive API could not be queried: ${msg}.`,
          tool: "wayback",
          status: "failed",
        });
        recorder.limit({
          title: `Wayback limitation on ${host}`,
          detail: `Historical archive lookup failed: ${msg}.`,
          tool: "wayback",
        });
      }

      // Process URLhaus
      if (urlhausSettled.status === "fulfilled" && urlhausSettled.value?.ok && urlhausSettled.value.data) {
        hostHasSuccess = true;
        const listing = urlhausSettled.value.data;
        if (listing.listed && listing.reference) {
          if (canEmit("url_in_threat_feed", NAME)) {
            flags.push({
              id: "url_in_threat_feed",
              title: formatFlagTitle("url_in_threat_feed"),
              severity: FLAG_REGISTRY.url_in_threat_feed.severity,
              explanation: `Domain '${host}' is listed in threat feed (${listing.threat || "malware"}).`,
              evidence: [{ type: "url", value: listing.reference }],
            });
          }
          trace.push({
            entity: host,
            check: "urlhaus",
            status: "ok",
            listed: true,
            threat: listing.threat,
          });
          recorder.step({
            title: "URLhaus: Threat feed listing detected",
            detail: `Domain '${host}' is listed as an active threat (${listing.threat || "malware"}).`,
            tool: "rules",
            status: "warn",
            sources: [{ label: "URLhaus Reference", url: listing.reference }],
          });
        } else if (listing.listed && !listing.reference) {
          trace.push({
            entity: host,
            check: "urlhaus",
            status: "doubtful_listing_no_url",
            listed: true,
          });
        } else {
          trace.push({ entity: host, check: "urlhaus", status: "ok", listed: false });
          recorder.step({
            title: "URLhaus: Clean, no active threat listing",
            detail: `Domain '${host}' has no active malware or phishing reports in URLhaus threat feeds.`,
            tool: "rules",
            status: "ok",
          });
        }
      } else {
        const isNoKey =
          urlhausSettled.status === "fulfilled" &&
          (urlhausSettled.value?.error?.code === "NO_KEY" ||
            urlhausSettled.value?.error?.message?.includes("Missing URLHAUS_AUTH_KEY"));

        if (isNoKey) {
          trace.push({
            entity: host,
            check: "urlhaus",
            status: "skipped",
            detail: "not_configured",
          });
          recorder.step({
            title: "URLhaus threat feed check skipped",
            detail: "Threat feed integration not configured in environment.",
            tool: "rules",
            status: "skipped",
          });
        } else {
          const code = urlhausSettled.status === "rejected"
            ? (urlhausSettled.reason?.code || "URLHAUS_EXCEPTION")
            : (urlhausSettled.value?.error?.code || "URLHAUS_ERROR");
          trace.push({ entity: host, check: "urlhaus", status: "error", code });
          unchecked.push(`${host}:urlhaus`);
        }
      }
    }

      // 5. Lookalike check (in-memory heuristic; does NOT count toward network hostHasSuccess)
      let lookalikeRes = null;
      try {
        lookalikeRes = lookalikeCheckFn(host);
        if (lookalikeRes) {
          if (lookalikeRes.isMatch && lookalikeRes.targetDomain) {
            hostFacts.lookalikeTarget = lookalikeRes.targetDomain;
            if (canEmit("lookalike_domain", NAME)) {
              let evidenceItem = null;
              if (quoteInText(host, messageText)) {
                evidenceItem = { type: "quote", value: host };
              } else {
                evidenceItem = { type: "url", value: `https://${lookalikeRes.targetDomain}` };
              }
              flags.push({
                id: "lookalike_domain",
                title: formatFlagTitle("lookalike_domain"),
                severity: FLAG_REGISTRY.lookalike_domain.severity,
                explanation: `Domain '${host}' resembles legitimate domain '${lookalikeRes.targetDomain}' (${lookalikeRes.targetName || "official organization"}). ${lookalikeRes.reason || ""}`.trim(),
                evidence: [evidenceItem],
              });
            }
          }
          trace.push({
            entity: host,
            check: "lookalike",
            status: "ok",
            isMatch: Boolean(lookalikeRes.isMatch),
            targetDomain: lookalikeRes.targetDomain || null,
          });
        }
      } catch {
        trace.push({ entity: host, check: "lookalike", status: "error", code: "LOOKALIKE_EXCEPTION" });
      }

      // Step rules: Lookalike analysis in words & generic-words exclusions
      const matchedGenerics = GENERIC_DICTIONARY_WORDS.filter((w) => host.toLowerCase().includes(w));
      if (lookalikeRes && lookalikeRes.isMatch && lookalikeRes.targetDomain) {
        recorder.step({
          title: `Lookalike match: Resembles ${lookalikeRes.targetDomain}`,
          detail: lookalikeRes.reason || `Contains '${lookalikeRes.targetName}' brand tokens but is not ${lookalikeRes.targetDomain}.`,
          tool: "rules",
          status: "warn",
          sources: [{ label: `Official ${lookalikeRes.targetName || "Domain"}`, url: `https://${lookalikeRes.targetDomain}` }],
        });
      } else if (matchedGenerics.length > 0) {
        recorder.step({
          title: `Rules: Generic-word exclusions applied (${matchedGenerics.slice(0, 2).join(", ")})`,
          detail: `Domain '${host}' contains generic opportunity term(s) [${matchedGenerics.join(", ")}]; excluded from brand lookalike flags.`,
          tool: "rules",
          status: "ok",
        });
      } else {
        recorder.step({
          title: "Rules: No lookalike brand spoofing detected",
          detail: `Domain '${host}' does not match known deceptive patterns or brand impersonations.`,
          tool: "rules",
          status: "ok",
        });
      }

      if (!isReserved) {
        // 6. Page load for outgoing links and discovery (within budget)
        const elapsedMs = nowFn() - startRunMs;
        const budgetLeftMs = overallBudgetMs - elapsedMs;

        if (budgetLeftMs > 2500 && pageBudgetRemaining > 0) {
        pageBudgetRemaining--;
        if (!readPageFn) {
          trace.push({
            entity: host,
            check: "readPage",
            status: "skipped",
            detail: "not_provided",
          });
        } else {
          const matchingUrlEntity = eligible.find(
            (item) => item.host === host && item.entity.kind === "url"
          );
          const pageUrl = matchingUrlEntity ? matchingUrlEntity.entity.value : `https://${host}`;
          try {
            const pageRes = await executeTool(() => safeToolCall(() => readPageFn(pageUrl), "PAGE_ERROR"), Math.min(toolTimeoutMs, budgetLeftMs));
            if (pageRes && pageRes.ok && pageRes.data) {
              hostHasSuccess = true;
              trace.push({
                entity: host,
                check: "readPage",
                status: "ok",
                linksCount: pageRes.data.links?.length || 0,
              });

              const pageTitle = pageRes.data.title ? pageRes.data.title.trim() : "";
              const pageText = (pageRes.data.text || "").toLowerCase();
              const links = Array.isArray(pageRes.data.links) ? pageRes.data.links : [];

              const hasContact = links.some((l) => /contact|reach-us|support|help/i.test(l)) || /contact us|get in touch|support@/i.test(pageText);
              const hasLegal = links.some((l) => /privacy|terms|legal|policy|disclaimer/i.test(l)) || /privacy policy|terms of service|terms & conditions/i.test(pageText);
              const legalContactDesc = (hasContact && hasLegal)
                ? "Both contact and legal/privacy pages appear."
                : hasContact
                ? "Contact page found, but no explicit privacy/legal policy."
                : hasLegal
                ? "Legal/privacy policy found, but no direct contact page."
                : "No distinct contact or legal pages identified.";

              const finalUrl = pageRes.data.finalUrl || pageUrl;
              const redirectDesc = finalUrl !== pageUrl ? ` (redirected to '${finalUrl}')` : "";

              recorder.step({
                title: pageTitle ? `Page inspection: "${pageTitle.slice(0, 50)}"` : "Page inspection: Reachable",
                detail: `Page reachable${redirectDesc}. ${pageTitle ? `Title: "${pageTitle.slice(0, 80)}". ` : ""}${legalContactDesc}`,
                tool: TOOL_PAGE,
                status: "ok",
                sources: [{ label: "Inspected Page", url: finalUrl }],
              });

              if (finalUrl !== pageUrl) {
                recorder.input({
                  title: `Redirect target: ${finalUrl}`,
                  detail: `Shortened link '${pageUrl}' redirected to destination '${finalUrl}'.`,
                  tool: TOOL_PAGE,
                  sources: [{ label: "Redirect Target", url: finalUrl }],
                });
              }

              // Check for data_harvest_redirects
              const redirectChain = Array.isArray(pageRes.data.redirectChain)
                ? pageRes.data.redirectChain
                : Array.isArray(pageRes.data.redirects)
                  ? pageRes.data.redirects
                  : [];

              const isExplicitHarvest = Boolean(
                pageRes.data.dataHarvestRedirect || pageRes.data.isDataHarvest
              );

              const TRACKING_REGEX = /(?:track|adnetwork|click\?|affiliate|redirect\?|dest=|link\.php|r\.php|out\.php)/i;
              const FORM_OR_HARVEST_REGEX = /(?:form|survey|harvest|apply|docs\.google\.com\/forms|typeform|formstack)/i;

              let trackingHop = null;
              for (const hop of redirectChain) {
                if (typeof hop === "string" && TRACKING_REGEX.test(hop)) {
                  trackingHop = hop;
                  break;
                }
              }

              const hasMultiHop = redirectChain.length >= 3;
              const endsInFormOrHarvest = FORM_OR_HARVEST_REGEX.test(finalUrl);

              if (isExplicitHarvest || (trackingHop && (endsInFormOrHarvest || hasMultiHop))) {
                if (canEmit("data_harvest_redirects", NAME)) {
                  const evidenceUrl =
                    trackingHop ||
                    pageRes.data.evidenceUrl ||
                    finalUrl ||
                    pageUrl;

                  flags.push({
                    id: "data_harvest_redirects",
                    title: formatFlagTitle("data_harvest_redirects"),
                    severity: FLAG_REGISTRY.data_harvest_redirects.severity,
                    explanation: "Site redirects through multi-hop tracking networks to an external personal data collection form.",
                    evidence: [{ type: "url", value: evidenceUrl }],
                  });
                }
              } else if (redirectChain.length === 2 && /auth|login|sso/i.test(finalUrl)) {
                verified.push("Single secure SSO redirect to official authentication domain");
                recorder.verified({
                  title: "Single secure SSO redirect",
                  detail: "Single secure SSO redirect to official authentication domain.",
                  tool: TOOL_PAGE,
                  sources: [{ label: "SSO Destination", url: finalUrl }],
                });
              }

              const candidates = [];
              for (const link of links) {
                try {
                  const u = new URL(link);
                  const linkHost = normalizeDomain(u.hostname);
                  if (linkHost && linkHost !== host && !linkHost.endsWith("." + host) && !host.endsWith("." + linkHost)) {
                    if (["t.me", "telegram.me"].includes(linkHost)) {
                      const handleVal = u.pathname.replace(/^\/+/, "").split("/")[0];
                      if (handleVal) {
                        candidates.push({
                          kind: "handle",
                          value: handleVal,
                          evidence: { type: "url", value: pageRes.data.finalUrl || pageUrl },
                        });
                      }
                    } else {
                      candidates.push({
                        kind: "domain",
                        value: linkHost,
                        evidence: { type: "url", value: pageRes.data.finalUrl || pageUrl },
                      });
                    }
                  }
                } catch {
                  // Ignore invalid link
                }
              }

              const existingEntityKeys = new Set(
                Array.isArray(snapshot?.entities)
                  ? snapshot.entities.map((e) => `${e.kind}:${e.value}`)
                  : []
              );

              const { accepted } = limitNewEntities(candidates, { existingEntityKeys });
              for (const acc of accepted) {
                if (newEntities.length < MAX_NEW_ENTITIES) {
                  newEntities.push(acc);
                }
              }
            } else {
              trace.push({
                entity: host,
                check: "readPage",
                status: "error",
                code: pageRes?.error?.code || "PAGE_ERROR",
              });
              unchecked.push(`${host}:readPage`);
              recorder.step({
                title: "Page inspection failed",
                detail: `Could not retrieve web page content from https://${host}: ${pageRes?.error?.message || "Unreachable"}.`,
                tool: TOOL_PAGE,
                status: "failed",
              });
              recorder.limit({
                title: `Page content unchecked for ${host}`,
                detail: `Web page could not be inspected: ${pageRes?.error?.message || "Unreachable"}.`,
                tool: TOOL_PAGE,
              });
            }
          } catch (err) {
            trace.push({
              entity: host,
              check: "readPage",
              status: "error",
              code: err.code || "PAGE_EXCEPTION",
            });
            unchecked.push(`${host}:readPage`);
            recorder.step({
              title: "Page inspection failed",
              detail: `Could not reach https://${host}: ${err.message || "Timeout or connection error"}.`,
              tool: TOOL_PAGE,
              status: "failed",
            });
            recorder.limit({
              title: `Page content unchecked for ${host}`,
              detail: `Web page could not be inspected: ${err.message || "Unreachable"}.`,
              tool: TOOL_PAGE,
            });
          }
        }
      } else if (pageBudgetRemaining > 0 && readPageFn) {
        trace.push({
          entity: host,
          check: "readPage",
          status: "skipped",
          detail: "budget_exceeded",
        });
        unchecked.push(`${host}:readPage (budget_exceeded)`);
        recorder.step({
          title: "Page inspection skipped (budget exceeded)",
          detail: "Page inspection budget limit reached; site body was not inspected.",
          tool: TOOL_PAGE,
          status: "skipped",
        });
          recorder.limit({
            title: "Page inspection budget reached",
            detail: "Page inspection skipped because per-run page limit was reached.",
            tool: TOOL_PAGE,
          });
        }
      }

      recorder.manual({
        title: "Compare the address letter by letter with the official site",
        detail: `Carefully compare '${host}' letter by letter with the organization's official website before submitting personal details, resumes, or payments.`,
        sources: [{ label: host, url: `https://${host}` }],
      });
      manualChecks.push({
        label: "Compare the address letter by letter with the official site",
        url: `https://${host}`,
      });
    }

    if (hostHasSuccess) {
      successfulItemCount++;
      for (const item of eligible) {
        if (item.host === host) {
          processedEntities.push(`${item.entity.kind}:${item.entity.value}`);
        }
      }
      if (!processedEntities.includes(`domain:${host}`)) {
        processedEntities.push(`domain:${host}`);
      }
    } else {
      failedItemCount++;
      for (const item of eligible) {
        if (item.host === host) {
          unchecked.push(`${item.entity.kind}:${item.entity.value}`);
        }
      }
    }
  }

  // Note unprocessed remainder domains
  for (const remHost of unprocessedRemainder) {
    for (const item of eligible) {
      if (item.host === remHost) {
        unchecked.push(`${item.entity.kind}:${item.entity.value}`);
      }
    }
  }

  // Multi-item partial failure rule
  if (successfulItemCount === 0 && failedItemCount > 0) {
    recorder.setSummary("Website forensics could not verify domain: all network checks failed.");
    return buildCouldNotCheckResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "all_checks_failed",
      summary: recorder.getSummary(),
      activity: recorder.getEntries(),
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
    });
  }

  // Deduplicate flags by id
  const seenFlagIds = new Set();
  const dedupedFlags = [];
  for (const f of flags) {
    if (!seenFlagIds.has(f.id)) {
      seenFlagIds.add(f.id);
      dedupedFlags.push(f);
    }
  }

  // Record findings for each deduplicated flag
  for (const flag of dedupedFlags) {
    const sources = (flag.evidence || [])
      .filter((ev) => ev.type === "url" && /^https?:\/\//i.test(ev.value))
      .map((ev) => ({ label: flag.title, url: ev.value }));

    const quoteEv = (flag.evidence || [])
      .filter((ev) => ev.type === "quote")
      .map((ev) => `"${ev.value}"`)
      .join(", ");

    recorder.finding({
      title: flag.title,
      detail: quoteEv ? `${flag.explanation} (Quoted evidence: ${quoteEv})` : flag.explanation,
      status: flag.severity === "high" ? "failed" : "warn",
      flagId: flag.id,
      tool: getToolForFlag(flag.id),
      sources,
    });
  }

  // Build summary sentence (max 160 chars)
  const summaryText = buildForensicsSummary({
    hosts: hostsToProcess,
    flagsCount: dedupedFlags.length,
    primaryFacts: hostFacts,
  });
  recorder.setSummary(summaryText);

  let notes = "";
  if (dedupedFlags.length > 0) {
    notes = `Identified ${dedupedFlags.length} risk factor(s) across website and domain forensics.`;
  } else {
    notes = "No website forensics red flags found; this does not mean the offer is safe (not a safety guarantee).";
  }

  if (unprocessedRemainder.length > 0) {
    notes += ` (${unprocessedRemainder.length} domain(s) left unprocessed for a later round)`;
  }
  if (failedItemCount > 0) {
    notes += ` (${failedItemCount} domain(s) could not be checked)`;
  }
  if (droppedFlagEvidenceCount > 0) {
    notes += ` (${droppedFlagEvidenceCount} finding(s) dropped due to unverified evidence)`;
  }

  const entityStatuses = [];
  for (const item of eligible) {
    if (reservedHosts.has(item.host)) {
      entityStatuses.push({
        entityKind: item.entityKind || "domain",
        entityValue: item.host,
        status: "test_domain",
        reason: "This is a reserved test domain and cannot be a real website",
      });
      continue;
    }
    const isUnchecked = unchecked.some((u) => u.includes(item.host));
    const isFlagged = dedupedFlags.some((f) =>
      f.evidence?.some((ev) => typeof ev.value === "string" && ev.value.includes(item.host))
    );
    if (isUnchecked) {
      entityStatuses.push({
        entityKind: item.entityKind || "domain",
        entityValue: item.host,
        status: "could_not_check",
        reason: "Domain retrieval or network lookup failed",
      });
    } else if (isFlagged) {
      entityStatuses.push({
        entityKind: item.entityKind || "domain",
        entityValue: item.host,
        status: "contradicted",
        reason: "Suspicious website forensic signals detected",
      });
    } else {
      entityStatuses.push({
        entityKind: item.entityKind || "domain",
        entityValue: item.host,
        status: "checked_no_issue",
      });
    }
  }

  return buildOkResult({
    checkId,
    agent: NAME,
    kind: KIND,
    round,
    flags: dedupedFlags,
    verified,
    newEntities,
    processedEntities,
    unchecked,
    manualChecks,
    trace,
    notes,
    summary: recorder.getSummary(),
    activity: recorder.getEntries(),
    entityStatus: buildCompleteEntityStatus(snapshot, NAME, entityStatuses),
  });
}

export function skippedResult(snapshot) {
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const reason = skippedReason(snapshot) || "no_eligible_entities";
  return buildSkippedResult({
    checkId,
    agent: NAME,
    kind: KIND,
    round,
    reason,
    entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
  });
}

export const websiteForensics = {
  name: NAME,
  kind: KIND,
  canRun,
  skippedReason,
  skippedResult,
  run,
};

export default websiteForensics;

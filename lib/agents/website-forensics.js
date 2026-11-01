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
 * - Injected deps: { rdapLookup, dnsRecords, sslInfo, waybackFirstSeen, lookalikeCheck, urlhaus, urlscanSearch, readPage, now }
 * - Processes up to WEBSITE_MAX_DOMAINS_PER_RUN (3) domains per run; remainder left for later rounds.
 * - Independent tool lookups per domain:
 *     (a) domain_new: registered < DOMAIN_NEW_DAYS (30) days before now; evidence is tool's source URL.
 *     (b) domain_no_history: only when archive lookup succeeded and returned found: false.
 *     (c) ssl_anomaly: only on successful certificate read showing expired, not yet valid, mismatch, or self-signed.
 *     (d) lookalike_domain: only when tool reports isMatch: true; explanation names legitimate domain.
 *     (e) url_in_threat_feed: only when confirmed listing with a valid http/https reference URL.
 *     (f) verified items: plain facts (e.g. "Certificate valid, issued by <issuer>"), never safe verdicts.
 * - Outgoing link discovery via page tool (max WEBSITE_FETCH_BUDGET per run).
 * - Multi-item partial failure rule: ok if any check succeeded; could_not_check only when every eligible item failed.
 * - Failure reasons are fixed codes and contain no domain, URL, or message text.
 * - "No red flags found" is a valid ok result with a note that it is not a safety guarantee.
 */

import { FLAG_REGISTRY, canEmit } from "../contracts/flags.js";
import { normalizeDomain } from "../contracts/normalize.js";
import { isGovIn, rdapLookup as defaultRdapLookup, dnsRecords as defaultDnsRecords, sslInfo as defaultSslInfo, waybackFirstSeen as defaultWaybackFirstSeen } from "../tools/domain.js";
import { checkDomainLookalike as defaultLookalikeCheck } from "../tools/lookalike.js";
import { urlhausLookup as defaultUrlhaus } from "../tools/urlhaus.js";
import { urlscanSearch as defaultUrlscanSearch } from "../tools/urlscan.js";
import { parseAndUnwrapIp, isForbiddenIp } from "../tools/ssrf.js";
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
} from "./base.js";

export const NAME = "website_forensics";
export const KIND = "check";

export const ELIGIBLE_KINDS = Object.freeze(["domain", "url"]);

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
 * Returns the set of processed entity keys for this agent from the snapshot.
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
 * Returns unprocessed entities eligible for website_forensics.
 * A url entity is processed by its host.
 *
 * @param {object} snapshot
 * @returns {Array<{ entity: object, host: string }>}
 */
export function getEligibleUnprocessedEntities(snapshot) {
  if (!Array.isArray(snapshot?.entities)) {
    return [];
  }

  const processed = getProcessedEntityKeys(snapshot);
  const eligible = [];
  const seenHostEntities = new Set();

  for (const ent of snapshot.entities) {
    if (!ent || typeof ent.kind !== "string" || typeof ent.value !== "string") {
      continue;
    }
    if (!ELIGIBLE_KINDS.includes(ent.kind)) {
      continue;
    }

    const host = extractHost(ent.kind, ent.value);
    if (!host) {
      continue;
    }

    // A url or domain entity is considered processed if domain:<host> or <host> or <kind>:<value> is processed
    const isProcessed =
      processed.has(`domain:${host}`) ||
      processed.has(host) ||
      processed.has(`${ent.kind}:${ent.value}`);

    if (isProcessed) {
      continue;
    }

    const hostEntKey = `${ent.kind}:${ent.value}`;
    if (!seenHostEntities.has(hostEntKey)) {
      seenHostEntities.add(hostEntKey);
      eligible.push({ entity: ent, host });
    }
  }

  return eligible;
}

/**
 * Deterministic, synchronous eligibility check (no I/O, no LLM).
 *
 * @param {object} snapshot
 * @returns {boolean}
 */
export function canRun(snapshot) {
  const eligible = getEligibleUnprocessedEntities(snapshot);
  return eligible.length > 0;
}

/**
 * Reason helper when skipped.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function skippedReason(snapshot) {
  if (!Array.isArray(snapshot?.entities) || snapshot.entities.length === 0) {
    return "no_eligible_entities";
  }
  const eligible = getEligibleUnprocessedEntities(snapshot);
  if (eligible.length === 0) {
    return "all_entities_already_processed";
  }
  return "not_eligible";
}

/**
 * Formats a registry flag ID into Title Case.
 *
 * @param {string} flagId
 * @returns {string}
 */
export function formatFlagTitle(flagId) {
  return flagId
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Executes the Website Forensics agent run.
 *
 * @param {object} snapshot
 * @param {object} [deps={}] - Injected dependencies
 * @param {object} [options={}] - Options { timeoutMs, maxDomains, pageBudget }
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

  const eligible = getEligibleUnprocessedEntities(snapshot);
  if (eligible.length === 0) {
    return buildSkippedResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "no_eligible_entities",
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

  for (const host of hostsToProcess) {
    let hostHasSuccess = false;
    const parsedIp = parseAndUnwrapIp(host);
    const isIp = Boolean(parsedIp);

    if (isIp) {
      if (ctx?.note) {
        ctx.note(`Inspecting raw IP host ${host}`);
      }
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
      } else {
        const ipChecks = [];
        ipChecks.push(
          executeTool(() => sslInfoFn(host), toolTimeoutMs)
            .then((res) => ({ type: "ssl", res }))
            .catch((err) => ({ type: "ssl", err }))
        );

        if (pageBudgetRemaining > 0 && readPageFn) {
          pageBudgetRemaining--;
          const matchingUrlEntity = eligible.find(
            (item) => item.host === host && item.entity.kind === "url"
          );
          const pageUrl = matchingUrlEntity ? matchingUrlEntity.entity.value : `http://${host}`;
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
            } else if (item.err) {
              trace.push({ entity: host, check: "ssl", status: "error", code: item.err.code || "SSL_EXCEPTION" });
              unchecked.push(`${host}:ssl`);
            } else {
              trace.push({ entity: host, check: "ssl", status: "error", code: item.res?.error?.code || "SSL_ERROR" });
              unchecked.push(`${host}:ssl`);
            }
          } else if (item.type === "page") {
            if (item.res?.ok && item.res.data) {
              hostHasSuccess = true;
              trace.push({ entity: host, check: "readPage", status: "ok" });
            } else if (item.err) {
              trace.push({ entity: host, check: "readPage", status: "error", code: item.err.code || "PAGE_EXCEPTION" });
              unchecked.push(`${host}:readPage`);
            } else {
              trace.push({ entity: host, check: "readPage", status: "error", code: item.res?.error?.code || "PAGE_ERROR" });
              unchecked.push(`${host}:readPage`);
            }
          }
        }
      }
    } else {
      if (ctx?.note) {
        ctx.note(`Checking DNS, SSL, and RDAP records for ${host}`);
      }

      // 1-5: Independent network tools run in parallel
      const [rdapSettled, dnsSettled, sslSettled, waybackSettled, urlhausSettled] = await Promise.allSettled([
        executeTool(() => rdapLookupFn(host), toolTimeoutMs),
        executeTool(() => dnsRecordsFn(host), toolTimeoutMs),
        executeTool(() => sslInfoFn(host), toolTimeoutMs),
        executeTool(() => waybackFirstSeenFn(host), toolTimeoutMs),
        executeTool(() => urlhausFn({ host }), toolTimeoutMs),
      ]);

      // Process RDAP
      if (rdapSettled.status === "fulfilled" && rdapSettled.value?.ok && rdapSettled.value.data) {
        hostHasSuccess = true;
        const { registrationDate, ageDays, evidenceUrl } = rdapSettled.value.data;
        trace.push({ entity: host, check: "rdap", status: "ok", ageDays });

        if (registrationDate) {
          const nowMs = nowFn();
          const regMs = new Date(registrationDate).getTime();
          const computedAgeDays = !Number.isNaN(regMs)
            ? Math.max(0, Math.floor((nowMs - regMs) / (1000 * 60 * 60 * 24)))
            : ageDays;

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
          } else if (computedAgeDays !== null) {
            verified.push(`Domain registered ${computedAgeDays} days ago`);
          }
        }
      } else {
        const code = rdapSettled.status === "rejected"
          ? (rdapSettled.reason?.code || "RDAP_EXCEPTION")
          : (rdapSettled.value?.error?.code || "RDAP_ERROR");
        trace.push({ entity: host, check: "rdap", status: "error", code });
        unchecked.push(`${host}:rdap`);
      }

      // Process DNS
      if (dnsSettled.status === "fulfilled" && dnsSettled.value?.ok && dnsSettled.value.data) {
        hostHasSuccess = true;
        trace.push({
          entity: host,
          check: "dns",
          status: "ok",
          hasA: Boolean(dnsSettled.value.data.a?.length),
          hasMx: Boolean(dnsSettled.value.data.mx?.length),
        });
      } else {
        const code = dnsSettled.status === "rejected"
          ? (dnsSettled.reason?.code || "DNS_EXCEPTION")
          : (dnsSettled.value?.error?.code || "DNS_ERROR");
        trace.push({ entity: host, check: "dns", status: "error", code });
        unchecked.push(`${host}:dns`);
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
          }
        } else {
          verified.push(`Certificate valid, issued by ${cert.issuer || "trusted CA"}`);
        }
        trace.push({ entity: host, check: "ssl", status: "ok", authorized: cert.authorized });
      } else {
        const code = sslSettled.status === "rejected"
          ? (sslSettled.reason?.code || "SSL_EXCEPTION")
          : (sslSettled.value?.error?.code || "SSL_ERROR");
        trace.push({ entity: host, check: "ssl", status: "error", code });
        unchecked.push(`${host}:ssl`);
      }

      // Process Wayback
      if (waybackSettled.status === "fulfilled" && waybackSettled.value?.ok && waybackSettled.value.data) {
        hostHasSuccess = true;
        if (waybackSettled.value.data.found === false) {
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
        } else if (waybackSettled.value.data.firstSeen) {
          verified.push(`Earliest Wayback snapshot: ${waybackSettled.value.data.firstSeen}`);
        }
        trace.push({ entity: host, check: "wayback", status: "ok", found: waybackSettled.value.data.found });
      } else {
        const code = waybackSettled.status === "rejected"
          ? (waybackSettled.reason?.code || "WAYBACK_EXCEPTION")
          : (waybackSettled.value?.error?.code || "WAYBACK_ERROR");
        trace.push({ entity: host, check: "wayback", status: "error", code });
        unchecked.push(`${host}:wayback`);
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
        } else if (listing.listed && !listing.reference) {
          trace.push({
            entity: host,
            check: "urlhaus",
            status: "doubtful_listing_no_url",
            listed: true,
          });
        } else {
          trace.push({ entity: host, check: "urlhaus", status: "ok", listed: false });
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
        } else {
          const code = urlhausSettled.status === "rejected"
            ? (urlhausSettled.reason?.code || "URLHAUS_EXCEPTION")
            : (urlhausSettled.value?.error?.code || "URLHAUS_ERROR");
          trace.push({ entity: host, check: "urlhaus", status: "error", code });
          unchecked.push(`${host}:urlhaus`);
        }
      }

      // 5. Lookalike check (in-memory heuristic; does NOT count toward network hostHasSuccess)
      try {
        const lookalikeRes = lookalikeCheckFn(host);
        if (lookalikeRes) {
          if (lookalikeRes.isMatch && lookalikeRes.targetDomain) {
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

              const finalUrl = typeof pageRes.data.finalUrl === "string" ? pageRes.data.finalUrl : "";
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
              }

              const candidates = [];
              const links = Array.isArray(pageRes.data.links) ? pageRes.data.links : [];

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
            }
          } catch (err) {
            trace.push({
              entity: host,
              check: "readPage",
              status: "error",
              code: err.code || "PAGE_EXCEPTION",
            });
            unchecked.push(`${host}:readPage`);
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
      }
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
    return buildCouldNotCheckResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "all_checks_failed",
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
    manualChecks: [],
    trace,
    notes,
  });
}

export const websiteForensics = {
  name: NAME,
  kind: KIND,
  canRun,
  skippedReason,
  run,
};

export default websiteForensics;

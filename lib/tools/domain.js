/**
 * lib/tools/domain.js
 *
 * Domain intelligence tools for Layer L2:
 * - isGovIn(domain): Pure helper checking *.gov.in or *.nic.in
 * - rdapLookup(domain): Registration date, age in days, registrar, status. TTL 24 hours.
 *     Official RFC 9083 / ICANN RDAP standard: https://www.rfc-editor.org/rfc/rfc9083.html
 * - dnsRecords(domain): Node dns/promises records (A, AAAA, MX, NS, TXT). TTL 1 hour.
 * - sslInfo(domain, { pinnedIp }): TLS handshake with SNI to pinned IP. 5s timeout. TTL 24 hours.
 *     Extracts issuer, validFrom, validTo, daysRemaining, authorized.
 * - waybackFirstSeen(domain): Earliest snapshot from Wayback CDX API. TTL 7 days.
 *     Official Wayback CDX API doc: https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
 *     A domain with no snapshot is a fact ({ found: false, firstSeen: null }), not an error.
 *
 * Rules:
 * - Never throw; all functions return a ToolResult.
 * - External calls support dependency injection (customFetch, customDns, customTls) for testing.
 * - Uses base helpers (ok, fail, withTimeout, cachedTool, logToolExecution).
 */

import tls from "node:tls";
import dns from "node:dns/promises";
import { normalizeDomain } from "../contracts/normalize.js";
import { ok, fail, withTimeout, cachedTool, logToolExecution, hashKey } from "./base.js";

const RDAP_BOOTSTRAP_URL = "https://rdap.org/domain/";
const WAYBACK_CDX_URL = "https://web.archive.org/cdx/search/cdx";

/**
 * Pure check if a domain is an authentic Indian government domain (.gov.in or .nic.in).
 *
 * @param {string} domain
 * @returns {boolean}
 */
export function isGovIn(domain) {
  const norm = normalizeDomain(domain);
  if (!norm) return false;
  return norm.endsWith(".gov.in") || norm === "gov.in" || norm.endsWith(".nic.in") || norm === "nic.in";
}

/**
 * Checks if a domain is a reserved test name under RFC 2606 / RFC 6761.
 * Reserved TLDs: .test, .example, .invalid, .localhost
 * Reserved second-level domains: example.com, example.net, example.org (and subdomains)
 *
 * @param {string} domain
 * @returns {boolean}
 */
export function isReservedDomain(domain) {
  const norm = normalizeDomain(domain);
  if (!norm) return false;
  const parts = norm.split(".");
  const tld = parts[parts.length - 1];
  if (["test", "example", "invalid", "localhost"].includes(tld)) {
    return true;
  }
  if (
    norm === "example.com" || norm.endsWith(".example.com") ||
    norm === "example.net" || norm.endsWith(".example.net") ||
    norm === "example.org" || norm.endsWith(".example.org")
  ) {
    return true;
  }
  return false;
}

/**
 * Queries RDAP for registration information.
 * TTL: 24 hours (86,400s).
 * Doc URL: https://www.rfc-editor.org/rfc/rfc9083.html
 *
 * @param {string} domain
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchFn]
 * @param {object} [deps.db]
 * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export async function rdapLookup(domain, { fetchFn = globalThis.fetch, db } = {}) {
  const start = Date.now();
  const norm = normalizeDomain(domain);
  if (!norm) {
    return fail("INVALID_INPUT", "Invalid domain format for RDAP lookup");
  }

  const cacheKey = `rdap:${hashKey(norm)}`;

  return cachedTool(
    cacheKey,
    86400, // 24 hours
    async () => {
      try {
        const result = await withTimeout(async (signal) => {
          const res = await fetchFn(`${RDAP_BOOTSTRAP_URL}${encodeURIComponent(norm)}`, {
            method: "GET",
            headers: {
              Accept: "application/rdap+json, application/json",
              "User-Agent": "StudentOpportunityVerifier/1.0",
            },
            signal,
          });

          if (res.status === 404) {
            return ok({
              domain: norm,
              found: false,
              registrationDate: null,
              expirationDate: null,
              ageDays: null,
              registrar: null,
              status: [],
              evidenceUrl: `${RDAP_BOOTSTRAP_URL}${norm}`,
            });
          }

          if (res.status === 429) {
            return fail("RATE_LIMITED", `RDAP service rate limit exceeded (HTTP 429)`);
          }

          if (!res.ok) {
            return fail("UPSTREAM_ERROR", `RDAP service responded with HTTP ${res.status}`);
          }

          const json = await res.json();

          // Extract registration date from events array: eventAction === "registration"
          let registrationDate = null;
          let expirationDate = null;
          if (Array.isArray(json.events)) {
            for (const ev of json.events) {
              if (ev.eventAction === "registration") {
                registrationDate = ev.eventDate;
              } else if (ev.eventAction === "expiration") {
                expirationDate = ev.eventDate;
              }
            }
          }

          // Calculate age in days
          let ageDays = null;
          if (registrationDate) {
            const regTime = new Date(registrationDate).getTime();
            if (!Number.isNaN(regTime)) {
              ageDays = Math.max(0, Math.floor((Date.now() - regTime) / (1000 * 60 * 60 * 24)));
            }
          }

          // Extract registrar
          let registrar = null;
          if (Array.isArray(json.entities)) {
            for (const ent of json.entities) {
              if (Array.isArray(ent.roles) && ent.roles.includes("registrar")) {
                if (ent.vcardArray && Array.isArray(ent.vcardArray[1])) {
                  const fnProp = ent.vcardArray[1].find((p) => p[0] === "fn");
                  if (fnProp) registrar = fnProp[3];
                }
                if (!registrar && ent.handle) {
                  registrar = ent.handle;
                }
              }
            }
          }

          return ok({
            domain: norm,
            found: true,
            registrationDate,
            expirationDate,
            ageDays,
            registrar,
            status: Array.isArray(json.status) ? json.status : [],
            evidenceUrl: `${RDAP_BOOTSTRAP_URL}${norm}`,
          });
        }, 10000);

        logToolExecution({
          tool: "rdapLookup",
          status: result.ok ? "ok" : "error",
          durationMs: Date.now() - start,
          code: result.ok ? undefined : result.error.code,
        });

        return result;
      } catch (err) {
        const isTimeout = err.name === "AbortError" || err.message?.includes("aborted");
        const code = isTimeout ? "TIMEOUT" : "NETWORK";
        logToolExecution({
          tool: "rdapLookup",
          status: "error",
          durationMs: Date.now() - start,
          code,
        });
        return fail(code, `RDAP lookup failed: ${err.message}`);
      }
    },
    db,
    "rdapLookup"
  );
}

/**
 * Resolves DNS records for a domain (A, AAAA, MX, NS, TXT).
 * TTL: 1 hour (3,600s).
 *
 * @param {string} domain
 * @param {object} [deps]
 * @param {typeof dns} [deps.dnsModule]
 * @param {object} [deps.db]
 * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export async function dnsRecords(domain, { dnsModule = dns, db } = {}) {
  const start = Date.now();
  const norm = normalizeDomain(domain);
  if (!norm) {
    return fail("INVALID_INPUT", "Invalid domain format for DNS lookup");
  }

  const cacheKey = `dns:${hashKey(norm)}`;

  return cachedTool(
    cacheKey,
    3600, // 1 hour
    async () => {
      try {
        const records = {
          domain: norm,
          a: [],
          aaaa: [],
          mx: [],
          ns: [],
          txt: [],
        };

        const safeResolve = async (fn) => {
          try {
            return await fn();
          } catch {
            return [];
          }
        };

        const [a, aaaa, mx, ns, txt] = await withTimeout(
          () =>
            Promise.all([
              safeResolve(() => dnsModule.resolve4(norm)),
              safeResolve(() => dnsModule.resolve6(norm)),
              safeResolve(() => dnsModule.resolveMx(norm)),
              safeResolve(() => dnsModule.resolveNs(norm)),
              safeResolve(() => dnsModule.resolveTxt(norm)),
            ]),
          5000
        );

        records.a = a;
        records.aaaa = aaaa;
        records.mx = mx.map((m) => (typeof m === "string" ? m : `${m.priority} ${m.exchange}`));
        records.ns = ns;
        records.txt = txt.map((t) => (Array.isArray(t) ? t.join("") : String(t)));

        const result = ok(records);

        logToolExecution({
          tool: "dnsRecords",
          status: "ok",
          durationMs: Date.now() - start,
        });

        return result;
      } catch (err) {
        const isTimeout = err.name === "AbortError" || err.message?.includes("aborted");
        const code = isTimeout ? "TIMEOUT" : "NETWORK";
        logToolExecution({
          tool: "dnsRecords",
          status: "error",
          durationMs: Date.now() - start,
          code,
        });
        return fail(code, `DNS query failed: ${err.message}`);
      }
    },
    db,
    "dnsRecords"
  );
}

/**
 * Connects to pinned IP over TLS with SNI servername to extract SSL certificate details.
 * Timeout: 5 seconds.
 * TTL: 24 hours (86,400s).
 *
 * @param {string} domain
 * @param {object} [options]
 * @param {string} [options.pinnedIp]
 * @param {typeof tls} [options.tlsModule]
 * @param {object} [options.db]
 * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export async function sslInfo(domain, { pinnedIp, tlsModule = tls, db } = {}) {
  const start = Date.now();
  const norm = normalizeDomain(domain);
  if (!norm) {
    return fail("INVALID_INPUT", "Invalid domain format for SSL lookup");
  }

  const connectTarget = pinnedIp || norm;
  const cacheKey = `ssl:${hashKey(`${norm}:${connectTarget}`)}`;

  return cachedTool(
    cacheKey,
    86400, // 24 hours
    async () => {
      try {
        const certInfo = await withTimeout(
          () =>
            new Promise((resolve, reject) => {
              const socket = tlsModule.connect(
                {
                  host: connectTarget,
                  port: 443,
                  servername: norm, // SNI
                  rejectUnauthorized: false, // We check and return authorization status explicitly
                  timeout: 5000,
                },
                () => {
                  try {
                    const cert = socket.getPeerCertificate(true);
                    const authorized = socket.authorized;
                    const authError = socket.authorizationError ? String(socket.authorizationError) : null;
                    socket.end();

                    if (!cert || Object.keys(cert).length === 0) {
                      return resolve(null);
                    }

                    const validFrom = cert.valid_from ? new Date(cert.valid_from).toISOString() : null;
                    const validTo = cert.valid_to ? new Date(cert.valid_to).toISOString() : null;

                    let daysRemaining = null;
                    if (validTo) {
                      const expireMs = new Date(validTo).getTime();
                      if (!Number.isNaN(expireMs)) {
                        daysRemaining = Math.floor((expireMs - Date.now()) / (1000 * 60 * 60 * 24));
                      }
                    }

                    resolve({
                      domain: norm,
                      issuer: cert.issuer?.O || cert.issuer?.CN || (typeof cert.issuer === "string" ? cert.issuer : null),
                      subject: cert.subject?.CN || (typeof cert.subject === "string" ? cert.subject : null),
                      validFrom,
                      validTo,
                      daysRemaining,
                      authorized,
                      authError,
                    });
                  } catch (err) {
                    reject(err);
                  }
                }
              );

              socket.on("error", (err) => {
                reject(err);
              });

              socket.on("timeout", () => {
                socket.destroy();
                reject(new Error("SSL socket timed out"));
              });
            }),
          5000
        );

        if (!certInfo) {
          return fail("UPSTREAM_ERROR", "No TLS certificate retrieved from peer");
        }

        const result = ok(certInfo);
        logToolExecution({
          tool: "sslInfo",
          status: "ok",
          durationMs: Date.now() - start,
        });
        return result;
      } catch (err) {
        const isTimeout = err.name === "AbortError" || err.message?.includes("timed out");
        const code = isTimeout ? "TIMEOUT" : "NETWORK";
        logToolExecution({
          tool: "sslInfo",
          status: "error",
          durationMs: Date.now() - start,
          code,
        });
        return fail(code, `SSL handshake error: ${err.message}`);
      }
    },
    db,
    "sslInfo"
  );
}

/**
 * Queries Wayback Machine CDX API for the earliest archived snapshot of a domain.
 * TTL: 7 days (604,800s).
 * Doc URL: https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
 *
 * Missing snapshot is a fact ({ found: false, firstSeen: null }), not an error.
 * Note: Queries the root URL for the domain. Absence of snapshots for the root is
 * weak evidence on its own, but indicative when corroborating young domain age.
 *
 * @param {string} domain
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetchFn]
 * @param {object} [deps.db]
 * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export async function waybackFirstSeen(domain, { fetchFn = globalThis.fetch, db } = {}) {
  const start = Date.now();
  const norm = normalizeDomain(domain);
  if (!norm) {
    return fail("INVALID_INPUT", "Invalid domain format for Wayback lookup");
  }

  const cacheKey = `wayback:${hashKey(norm)}`;

  return cachedTool(
    cacheKey,
    604800, // 7 days
    async () => {
      try {
        const result = await withTimeout(async (signal) => {
          // Documented CDX API parameters:
          // url: Target URL / domain to search
          // output: json format
          // limit: 1 (CDX indexes default to chronologically ascending by timestamp)
          // filter: statuscode:200 to only consider successful historical captures
          // Doc: https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
          const params = new URLSearchParams({
            url: norm,
            output: "json",
            limit: "1",
            filter: "statuscode:200",
          });

          const cdxUrl = `${WAYBACK_CDX_URL}?${params.toString()}`;

          const res = await fetchFn(cdxUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": "StudentOpportunityVerifier/1.0",
            },
            signal,
          });

          if (res.status === 429) {
            return fail("RATE_LIMITED", `Wayback CDX API rate limit exceeded (HTTP 429)`);
          }

          if (!res.ok) {
            return fail("UPSTREAM_ERROR", `Wayback CDX API responded with HTTP ${res.status}`);
          }

          let data;
          try {
            const raw = await res.text();
            if (!raw || !raw.trim()) {
              return ok({
                domain: norm,
                found: false,
                firstSeen: null,
                evidenceUrl: null,
              });
            }
            data = JSON.parse(raw);
          } catch {
            return ok({
              domain: norm,
              found: false,
              firstSeen: null,
              evidenceUrl: null,
            });
          }

          // CDX JSON format: first row is headers [urlkey, timestamp, original, mimetype, statuscode, digest, length]
          // Second row is the first record
          if (!Array.isArray(data) || data.length < 2) {
            return ok({
              domain: norm,
              found: false,
              firstSeen: null,
              evidenceUrl: null,
            });
          }

          const headers = data[0];
          const record = data[1];
          const tsIndex = headers.indexOf("timestamp");
          const origIndex = headers.indexOf("original");

          const rawTs = tsIndex !== -1 ? record[tsIndex] : null;
          const origUrl = origIndex !== -1 ? record[origIndex] : `http://${norm}`;

          let firstSeen = null;
          let evidenceUrl = null;

          if (rawTs && rawTs.length >= 8) {
            // Timestamp format: YYYYMMDDhhmmss
            const year = rawTs.slice(0, 4);
            const month = rawTs.slice(4, 6);
            const day = rawTs.slice(6, 8);
            firstSeen = `${year}-${month}-${day}`;
            evidenceUrl = `https://web.archive.org/web/${rawTs}/${origUrl}`;
          }

          return ok({
            domain: norm,
            found: true,
            firstSeen,
            evidenceUrl,
          });
        }, 10000);

        logToolExecution({
          tool: "waybackFirstSeen",
          status: result.ok ? "ok" : "error",
          durationMs: Date.now() - start,
          code: result.ok ? undefined : result.error.code,
        });

        return result;
      } catch (err) {
        const isTimeout = err.name === "AbortError" || err.message?.includes("aborted");
        const code = isTimeout ? "TIMEOUT" : "NETWORK";
        logToolExecution({
          tool: "waybackFirstSeen",
          status: "error",
          durationMs: Date.now() - start,
          code,
        });
        return fail(code, `Wayback CDX lookup failed: ${err.message}`);
      }
    },
    db,
    "waybackFirstSeen"
  );
}

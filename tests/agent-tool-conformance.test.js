/**
 * tests/agent-tool-conformance.test.js
 *
 * Conformance test suite verifying that all REAL L2 tools produce outputs
 * that strictly match their Zod schemas when executed with fake network/injected deps.
 *
 * Verifies:
 * - rdapLookup
 * - dnsRecords
 * - sslInfo
 * - waybackFirstSeen
 * - lookalikeCheck
 * - urlhausLookup
 * - urlscanSearch
 * - fetchPage
 * - search
 * - graph lookup
 * - upiFacts
 * - phoneFacts
 * - emailFacts
 *
 * NO real network traffic. NO persistent database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  rdapLookup,
  dnsRecords,
  sslInfo,
  waybackFirstSeen,
} from "../lib/tools/domain.js";
import { checkDomainLookalike } from "../lib/tools/lookalike.js";
import { urlhausLookup } from "../lib/tools/urlhaus.js";
import { urlscanSearch } from "../lib/tools/urlscan.js";
import { createFetchPage } from "../lib/tools/fetchPage.js";
import { search } from "../lib/tools/search.js";
import { lookup as graphLookup } from "../lib/graph.js";
import { upiFacts, phoneFacts, emailFacts } from "../lib/tools/payments.js";
import {
  validateToolResult,
  RdapLookupResultSchema,
  DnsRecordsResultSchema,
  SslInfoResultSchema,
  WaybackFirstSeenResultSchema,
  LookalikeCheckDataSchema,
  UrlhausResultSchema,
  UrlscanSearchResultSchema,
  FetchPageResultSchema,
  SearchResultSchema,
  GraphMatchSchema,
  UpiFactsSchema,
  PhoneFactsSchema,
  EmailFactsSchema,
} from "./helpers/tool-result-schemas.js";
import { safeToolCall } from "../lib/agents/base.js";

test("safeToolCall unifies thrown errors and returned error shapes", async () => {
  // Style 1: Thrown Error
  const thrownRes = await safeToolCall(async () => {
    const err = new Error("Connection timed out");
    err.code = "TIMEOUT";
    throw err;
  });
  assert.equal(thrownRes.ok, false);
  assert.equal(thrownRes.error.code, "TIMEOUT");

  // Style 2: Returned { ok: false, error: { code } }
  const returnedRes = await safeToolCall(async () => ({
    ok: false,
    error: { code: "BLOCKED", message: "Host blocked" },
  }));
  assert.equal(returnedRes.ok, false);
  assert.equal(returnedRes.error.code, "BLOCKED");

  // Style 3: Successful call
  const okRes = await safeToolCall(async () => ({
    ok: true,
    data: { result: "success" },
  }));
  assert.equal(okRes.ok, true);
  assert.equal(okRes.data.result, "success");
});

test("L2 Tool Conformance: rdapLookup matches schema with fake network", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      events: [
        { eventAction: "registration", eventDate: "2023-01-01T00:00:00Z" },
        { eventAction: "expiration", eventDate: "2025-01-01T00:00:00Z" },
      ],
      entities: [
        {
          roles: ["registrar"],
          vcardArray: ["vcard", [["fn", {}, "text", "Example Registrar LLC"]]],
        },
      ],
      status: ["clientTransferProhibited"],
    }),
  });

  const res = await rdapLookup("example.org", { fetchFn: fakeFetch });
  assert.equal(res.ok, true);
  const parsed = validateToolResult("rdapLookup", res);
  assert.equal(parsed.data.domain, "example.org");
  assert.equal(parsed.data.found, true);
  assert.equal(parsed.data.registrar, "Example Registrar LLC");
});

test("L2 Tool Conformance: dnsRecords matches schema with fake dns module", async () => {
  const fakeDns = {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => ["2606:2800:220:1:248:1893:25c8:1946"],
    resolveMx: async () => [{ priority: 10, exchange: "mail.example.org" }],
    resolveNs: async () => ["ns1.example.org", "ns2.example.org"],
    resolveTxt: async () => [["v=spf1 -all"]],
  };

  const res = await dnsRecords("example.org", { dnsModule: fakeDns });
  assert.equal(res.ok, true);
  const parsed = validateToolResult("dnsRecords", res);
  assert.deepEqual(parsed.data.a, ["93.184.216.34"]);
  assert.equal(parsed.data.mx[0], "10 mail.example.org");
});

test("L2 Tool Conformance: sslInfo matches schema with fake tls module", async () => {
  const fakeTls = {
    connect: (opts, cb) => {
      const socket = {
        getPeerCertificate: () => ({
          issuer: { O: "Let's Encrypt", CN: "R3" },
          subject: { CN: "example.org" },
          valid_from: "2024-01-01T00:00:00Z",
          valid_to: "2025-01-01T00:00:00Z",
        }),
        authorized: true,
        authorizationError: null,
        end: () => {},
        on: () => socket,
        destroy: () => {},
      };
      setImmediate(cb);
      return socket;
    },
  };

  const res = await sslInfo("example.org", { tlsModule: fakeTls });
  assert.equal(res.ok, true);
  const parsed = validateToolResult("sslInfo", res);
  assert.equal(parsed.data.domain, "example.org");
  assert.equal(parsed.data.authorized, true);
  assert.equal(parsed.data.issuer, "Let's Encrypt");
});

test("L2 Tool Conformance: waybackFirstSeen matches schema with fake network", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify([
        ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
        ["org,example)/", "20100520120000", "http://example.org", "text/html", "200", "HASH", "1234"],
      ]),
  });

  const res = await waybackFirstSeen("example.org", { fetchFn: fakeFetch });
  assert.equal(res.ok, true);
  const parsed = validateToolResult("waybackFirstSeen", res);
  assert.equal(parsed.data.found, true);
  assert.equal(parsed.data.firstSeen, "2010-05-20");
});

test("L2 Tool Conformance: lookalikeCheck matches schema", () => {
  const res = checkDomainLookalike("aicte-scholarship.org");
  const parsed = validateToolResult("lookalikeCheck", res);
  assert.equal(typeof parsed.isMatch, "boolean");
});

test("L2 Tool Conformance: urlhausLookup matches schema with fake network", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      query_status: "ok",
      threat: "malware_download",
      url_status: "online",
      date_added: "2024-02-01 12:00:00 UTC",
      tags: ["payload", "exe"],
      urlhaus_reference: "https://urlhaus.abuse.ch/url/12345/",
    }),
  });

  const res = await urlhausLookup(
    { host: "malicious.test" },
    { fetchFn: fakeFetch, customEnv: { URLHAUS_AUTH_KEY: "test-auth-key" } }
  );
  assert.equal(res.ok, true);
  const parsed = validateToolResult("urlhaus", res);
  assert.equal(parsed.data.listed, true);
  assert.equal(parsed.data.threat, "malware_download");
  assert.equal(parsed.data.reference, "https://urlhaus.abuse.ch/url/12345/");
});

test("L2 Tool Conformance: urlscanSearch matches schema with fake network", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      total: 1,
      results: [
        {
          _id: "scan-123",
          result: "https://urlscan.io/result/scan-123/",
          task: { time: "2024-01-15T10:00:00.000Z" },
          page: { domain: "scam-domain.com" },
        },
      ],
    }),
  });

  const res = await urlscanSearch(
    { domain: "scam-domain.com" },
    { fetchFn: fakeFetch, customEnv: { URLSCAN_API_KEY: "test-key" } }
  );
  assert.equal(res.ok, true);
  const parsed = validateToolResult("urlscanSearch", res);
  assert.equal(parsed.data.total, 1);
  assert.equal(parsed.data.results[0].resultUrl, "https://urlscan.io/result/scan-123/");
});

test("L2 Tool Conformance: fetchPage matches schema with fake network transport", async () => {
  const mockResolve = async () => ["93.184.216.34"];
  const mockRequest = async () => ({
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: Buffer.from(
      "<html><head><title>Portal</title><meta name='description' content='Desc'></head><body>Text <a href='/page2'>Link</a></body></html>"
    ),
  });

  const pageFetcher = createFetchPage({ resolve: mockResolve, request: mockRequest });
  const res = await pageFetcher("https://example.org/home");
  assert.equal(res.ok, true);
  const parsed = validateToolResult("fetchPage", res);
  assert.equal(parsed.data.finalUrl, "https://example.org/home");
  assert.equal(parsed.data.title, "Portal");
  assert.equal(parsed.data.metaDescription, "Desc");
  assert.ok(parsed.data.text.includes("Text"));
  assert.deepEqual(parsed.data.links, ["https://example.org/page2"]);
});

test("L2 Tool Conformance: search matches schema with fake network", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      organic: [
        {
          title: "PM Scholarship Warning",
          link: "https://pib.gov.in/factcheck/pm",
          snippet: "Beware of fake scholarship scams claiming ministry affiliation.",
          position: 1,
        },
      ],
    }),
  });

  const res = await search("PM scholarship scam", {
    fetchFn: fakeFetch,
    customEnv: { SEARCH_API_KEY: "test-serper-key" },
  });
  assert.equal(res.ok, true);
  const parsed = validateToolResult("search", res);
  assert.equal(parsed.data.total, 1);
  assert.equal(parsed.data.results[0].title, "PM Scholarship Warning");
  assert.equal(parsed.data.results[0].url, "https://pib.gov.in/factcheck/pm");
});

test("L2 Tool Conformance: graphLookup matches schema with in-memory test database", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE graph_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      report_count INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE TABLE graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_a INTEGER NOT NULL,
      node_b INTEGER NOT NULL,
      check_ref TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO graph_nodes (kind, value, report_count, first_seen, last_seen)
    VALUES ('upi', 'scammer@okaxis', 3, '2024-01-01', '2024-02-01');
  `);

  const hitRes = graphLookup("upi", "scammer@okaxis", { db });
  assert.equal(hitRes.matched, true);
  const parsedHit = validateToolResult("graphLookup", hitRes);
  assert.equal(parsedHit.value, "scammer@okaxis");
  assert.equal(parsedHit.reportCount, 3);

  const missRes = graphLookup("upi", "legit@okhdfcbank", { db });
  assert.equal(missRes.matched, false);
  const parsedMiss = validateToolResult("graphLookup", missRes);
  assert.equal(parsedMiss.matched, false);

  db.close();
});

test("L2 Tool Conformance: upiFacts matches schema", () => {
  const res = upiFacts("scholarship.dept@okaxis");
  const parsed = validateToolResult("upiFacts", res);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.handle, "okaxis");
  assert.equal(parsed.isKnownPsp, true);
});

test("L2 Tool Conformance: phoneFacts matches schema", () => {
  const res = phoneFacts("+919876543210");
  const parsed = validateToolResult("phoneFacts", res);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.country, "IN");
  assert.equal(parsed.e164, "+919876543210");
});

test("L2 Tool Conformance: emailFacts matches schema", () => {
  const res = emailFacts("recruiter@gmail.com");
  const parsed = validateToolResult("emailFacts", res);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.domain, "gmail.com");
  assert.equal(parsed.isFreeProvider, true);
});

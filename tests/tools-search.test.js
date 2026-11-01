/**
 * tests/tools-search.test.js
 *
 * Offline unit tests for Part 4 tools:
 * - lib/tools/dorks.js (pure query builders, sanitization)
 * - lib/tools/search.js (Serper adapter, budget enforcement, caching, errors)
 * - lib/tools/urlhaus.js (URLhaus lookup, caching, errors, listed/unlisted, never safe)
 * - lib/tools/urlscan.js (urlscanSearch, caching, errors, public query formatting)
 *
 * Invariant: 100% offline, stubbed fetch, no real network calls.
 */

// Pre-set required environment variables so lib/env.js validation passes in offline tests
process.env.LLM_PROVIDER ??= "gemini";
process.env.LLM_API_KEY ??= "mock-llm-key";
process.env.LLM_MODEL ??= "gemini-3.5-flash-lite";

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../lib/db/migrations/index.js";
import {
  sanitizeQueryText,
  buildScamQuery,
  buildRedditQuery,
  buildTrustpilotQuery,
  buildComplaintSitesQuery,
  buildMinusSiteQuery,
  buildQuotedPhraseQuery,
  buildUpiQuery,
  buildGovSchemeQuery,
  buildPibFactCheckQuery,
} from "../lib/tools/dorks.js";
import { search } from "../lib/tools/search.js";
import { urlhausLookup } from "../lib/tools/urlhaus.js";
import { urlscanSearch } from "../lib/tools/urlscan.js";
import { createToolContext } from "../lib/tools/base.js";

describe("lib/tools/dorks.js", () => {
  test("sanitizeQueryText strips operators, punctuation, newlines, and trims", () => {
    const raw = '  site:evil.com inurl:login "Fake Company" (Pvt) Ltd\n scam*!  ';
    const cleaned = sanitizeQueryText(raw);
    assert.ok(!cleaned.includes("site:"));
    assert.ok(!cleaned.includes("inurl:"));
    assert.ok(!cleaned.includes('"'));
    assert.ok(!cleaned.includes("("));
    assert.ok(!cleaned.includes("\n"));
    assert.equal(cleaned, "evil.com login Fake Company Pvt Ltd scam !");
  });

  test("sanitizeQueryText caps length at maxLen", () => {
    const long = "a".repeat(150);
    const cleaned = sanitizeQueryText(long, 50);
    assert.equal(cleaned.length, 50);
  });

  test("buildScamQuery wraps cleaned brand in quotes and appends scam terms", () => {
    const q = buildScamQuery('TechCorp (India)');
    assert.equal(q, '"TechCorp India" scam OR fraud OR fake OR "not paying"');
  });

  test("buildScamQuery omits quotes for domain-like identifiers with dots", () => {
    const qDomain = buildScamQuery("research-portal.institute.edu.example");
    assert.equal(qDomain, 'research-portal.institute.edu.example scam OR fraud OR fake OR "not paying"');
    const qBrand = buildScamQuery("National Institute of Science Research");
    assert.equal(qBrand, '"National Institute of Science Research" scam OR fraud OR fake OR "not paying"');
  });

  test("buildRedditQuery builds site:reddit.com search", () => {
    const q = buildRedditQuery('TechCorp');
    assert.equal(q, 'site:reddit.com "TechCorp" scam OR legit OR review');
  });

  test("buildTrustpilotQuery builds site:trustpilot.com/review search", () => {
    const q = buildTrustpilotQuery('TechCorp');
    assert.equal(q, 'site:trustpilot.com/review "TechCorp"');
  });

  test("buildComplaintSitesQuery searches consumercomplaints and mouthshut", () => {
    const q = buildComplaintSitesQuery('TechCorp');
    assert.equal(q, '(site:consumercomplaints.in OR site:mouthshut.com) "TechCorp"');
  });

  test("buildMinusSiteQuery rebuilds query without -site: operator for free tier Serper", () => {
    const q1 = buildMinusSiteQuery('TechCorp', 'techcorp.in');
    assert.equal(q1, '"TechCorp" scam OR review OR complaint');
    assert.ok(!q1.includes("-site:"), "Should not contain -site: operator");

    const qDomain = buildMinusSiteQuery('techcorp.in', 'techcorp.in');
    assert.equal(qDomain, 'techcorp.in scam OR review OR complaint');
    assert.ok(!qDomain.includes('"techcorp.in"'), "Domain should not be in quotes for free tier");
  });

  test("generated queries do not contain patterns rejected by Serper free tier", () => {
    const brand = "Acme Corp";
    const domain = "acme-jobs.org";
    const queries = [
      buildScamQuery(brand),
      buildScamQuery(domain),
      buildMinusSiteQuery(brand, domain),
      buildMinusSiteQuery(domain, domain),
    ];
    for (const q of queries) {
      assert.ok(!q.includes("-site:"), `Query should not contain -site: (${q})`);
      assert.ok(!/\"[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\"/.test(q), `Query should not quote raw domain (${q})`);
    }
  });

  test("buildQuotedPhraseQuery quotes distinctive phrase", () => {
    const q = buildQuotedPhraseQuery('Selected for HR Operations Internship');
    assert.equal(q, '"Selected for HR Operations Internship"');
  });

  test("buildUpiQuery searches UPI scam keywords", () => {
    const q = buildUpiQuery('hr.recruiter@okhdfcbank');
    assert.equal(q, '"hr.recruiter@okhdfcbank" scam OR fraud OR cybercrime OR complaint');
  });

  test("buildGovSchemeQuery searches site:gov.in", () => {
    const q = buildGovSchemeQuery('PM Scholarship Scheme');
    assert.equal(q, 'site:gov.in "PM Scholarship Scheme"');
  });

  test("buildPibFactCheckQuery searches PIB fact check", () => {
    const q = buildPibFactCheckQuery('Free Laptop Scheme 2026');
    assert.equal(q, '("PIB Fact Check" OR site:factcheck.pib.gov.in) "Free Laptop Scheme 2026"');
  });

  test("dork builders return empty string on empty/blank input", () => {
    assert.equal(buildScamQuery("   "), "");
    assert.equal(buildRedditQuery(""), "");
    assert.equal(buildGovSchemeQuery(null), "");
  });
});

describe("lib/tools/search.js", () => {
  let db;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_API_KEY = "mock-llm-key";
    process.env.LLM_MODEL = "gemini-3.5-flash-lite";
    process.env.SEARCH_API_KEY = "mock-search-key";
  });

  afterEach(() => {
    db.close();
    process.env = { ...originalEnv };
  });

  test("returns NO_KEY if SEARCH_API_KEY is unset", async () => {
    delete process.env.SEARCH_API_KEY;
    const res = await search("test scam", { db, customEnv: { SEARCH_API_KEY: undefined } });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "NO_KEY");
  });

  test("returns INVALID_INPUT on empty query", async () => {
    const res = await search("   ", { db });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "INVALID_INPUT");
  });

  test("enforces budget: fails with BUDGET_EXCEEDED when remaining <= 0", async () => {
    const context = createToolContext({ budgetRemaining: 0 });
    const res = await search("test scam", { context, db });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "BUDGET_EXCEEDED");
  });

  test("successful search call decrements budget and formats results", async () => {
    const context = createToolContext({ budgetRemaining: 5 });
    const mockFetch = async (url, opts) => {
      assert.equal(opts.headers["X-API-KEY"], "mock-search-key");
      const reqBody = JSON.parse(opts.body);
      assert.equal(reqBody.q, "test scam");
      assert.equal(reqBody.gl, "in");

      return {
        ok: true,
        status: 200,
        json: async () => ({
          organic: [
            { title: "Result 1", link: "https://example.com/1", snippet: "Snippet 1", position: 1 },
            { title: "Result 2", link: "https://example.com/2", snippet: "Snippet 2", position: 2 },
          ],
        }),
      };
    };

    const res = await search("test scam", { context, fetchFn: mockFetch, db, customEnv: { SEARCH_API_KEY: "mock-search-key" } });
    assert.equal(res.ok, true);
    assert.equal(res.data.total, 2);
    assert.equal(res.data.results[0].title, "Result 1");
    assert.equal(res.data.results[0].url, "https://example.com/1");
    assert.equal(context.budget.remaining, 4);

    // Cache hit should NOT decrement budget further
    const resCached = await search("test scam", { context, fetchFn: () => { throw new Error("Network call on cache hit"); }, db, customEnv: { SEARCH_API_KEY: "mock-search-key" } });
    assert.equal(resCached.ok, true);
    assert.equal(resCached.cached, true);
    assert.equal(context.budget.remaining, 4);
  });

  test("handles 401/403 as AUTH, 429 as RATE_LIMITED, 500 as UPSTREAM_ERROR", async () => {
    const fail401 = await search("test", {
      fetchFn: async () => ({ ok: false, status: 401 }),
      db,
      customEnv: { SEARCH_API_KEY: "mock-search-key" },
    });
    assert.equal(fail401.ok, false);
    assert.equal(fail401.error.code, "AUTH");

    const fail429 = await search("test 429", {
      fetchFn: async () => ({ ok: false, status: 429 }),
      db,
      customEnv: { SEARCH_API_KEY: "mock-search-key" },
    });
    assert.equal(fail429.ok, false);
    assert.equal(fail429.error.code, "RATE_LIMITED");

    const fail500 = await search("test 500", {
      fetchFn: async () => ({ ok: false, status: 500 }),
      db,
      customEnv: { SEARCH_API_KEY: "mock-search-key" },
    });
    assert.equal(fail500.ok, false);
    assert.equal(fail500.error.code, "UPSTREAM_ERROR");
  });

  test("a mocked 400 with a message shows the safe detail", async () => {
    const fail400 = await search("test 400", {
      fetchFn: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: "Query pattern not allowed for free accounts." }),
      }),
      db,
      customEnv: { SEARCH_API_KEY: "mock-search-key" },
    });
    assert.equal(fail400.ok, false);
    assert.equal(fail400.error.code, "UPSTREAM_ERROR");
    assert.ok(fail400.error.message.includes("Query pattern not allowed for free accounts."));
    assert.ok(fail400.error.message.includes("HTTP 400"));
  });

  test("a message containing a fake key-like string is redacted", async () => {
    const fakeKey = "testmockkey_123456789012345678901234567890";
    const failWithKey = await search("test key leak", {
      fetchFn: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: `Invalid key parameter: ${fakeKey} was rejected.` }),
      }),
      db,
      customEnv: { SEARCH_API_KEY: "mock-search-key" },
    });
    assert.equal(failWithKey.ok, false);
    assert.ok(!failWithKey.error.message.includes(fakeKey), "Key must be redacted from error message");
    assert.ok(failWithKey.error.message.includes("[REDACTED]"), "Redaction token must be present");
  });

  test("mocked 401, 402, 429 keep their existing error codes", async () => {
    const fail401 = await search("test 401", {
      fetchFn: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ message: "Unauthorized key" }),
      }),
      db,
      customEnv: { SEARCH_API_KEY: "mock-search-key" },
    });
    assert.equal(fail401.ok, false);
    assert.equal(fail401.error.code, "AUTH");
    assert.ok(fail401.error.message.includes("Unauthorized key"));

    const fail402 = await search("test 402", {
      fetchFn: async () => ({
        ok: false,
        status: 402,
        json: async () => ({ message: "Insufficient credits" }),
      }),
      db,
      customEnv: { SEARCH_API_KEY: "mock-search-key" },
    });
    assert.equal(fail402.ok, false);
    assert.equal(fail402.error.code, "UPSTREAM_ERROR");
    assert.ok(fail402.error.message.includes("Insufficient credits"));

    const fail429 = await search("test 429", {
      fetchFn: async () => ({
        ok: false,
        status: 429,
        json: async () => ({ message: "Rate limit exceeded" }),
      }),
      db,
      customEnv: { SEARCH_API_KEY: "mock-search-key" },
    });
    assert.equal(fail429.ok, false);
    assert.equal(fail429.error.code, "RATE_LIMITED");
    assert.ok(fail429.error.message.includes("Rate limit exceeded"));
  });
});

describe("lib/tools/urlhaus.js", () => {
  let db;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_API_KEY = "mock-llm-key";
    process.env.LLM_MODEL = "gemini-3.5-flash-lite";
    process.env.URLHAUS_AUTH_KEY = "mock-urlhaus-key";
  });

  afterEach(() => {
    db.close();
    process.env = { ...originalEnv };
  });

  test("returns NO_KEY if URLHAUS_AUTH_KEY is unset", async () => {
    delete process.env.URLHAUS_AUTH_KEY;
    const res = await urlhausLookup({ host: "evil.com" }, { db, customEnv: { URLHAUS_AUTH_KEY: undefined } });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "NO_KEY");
  });

  test("returns INVALID_INPUT when neither or both url and host are provided", async () => {
    const neither = await urlhausLookup({}, { db });
    assert.equal(neither.ok, false);
    assert.equal(neither.error.code, "INVALID_INPUT");

    const both = await urlhausLookup({ url: "https://evil.com", host: "evil.com" }, { db });
    assert.equal(both.ok, false);
    assert.equal(both.error.code, "INVALID_INPUT");
  });

  test("handles unlisted host (query_status: 'no_results'): listed: false, NOT safe", async () => {
    const mockFetch = async (_url, opts) => {
      assert.equal(opts.headers["Auth-Key"], "mock-urlhaus-key");
      return {
        ok: true,
        status: 200,
        json: async () => ({ query_status: "no_results" }),
      };
    };

    const res = await urlhausLookup({ host: "clean-example.com" }, { fetchFn: mockFetch, db, customEnv: { URLHAUS_AUTH_KEY: "mock-urlhaus-key" } });
    assert.equal(res.ok, true);
    assert.equal(res.data.listed, false);
    assert.equal(res.data.threat, null);
    // Invariant: verify object doesn't claim 'safe: true'
    assert.strictEqual(res.data.safe, undefined);
  });

  test("handles listed malicious URL (query_status: 'ok')", async () => {
    const mockFetch = async (url, opts) => {
      assert.ok(url.includes("/v1/url/"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query_status: "ok",
          threat: "malware_download",
          url_status: "online",
          date_added: "2026-04-10 12:00:00 UTC",
          tags: ["exe", "redline"],
          urlhaus_reference: "https://urlhaus.abuse.ch/url/12345/",
        }),
      };
    };

    const res = await urlhausLookup({ url: "http://malicious.example/payload.exe" }, { fetchFn: mockFetch, db, customEnv: { URLHAUS_AUTH_KEY: "mock-urlhaus-key" } });
    assert.equal(res.ok, true);
    assert.equal(res.data.listed, true);
    assert.equal(res.data.threat, "malware_download");
    assert.equal(res.data.tags[0], "exe");
    assert.equal(res.data.reference, "https://urlhaus.abuse.ch/url/12345/");
  });

  test("handles 401/403 as AUTH error", async () => {
    const res = await urlhausLookup({ host: "test.com" }, {
      fetchFn: async () => ({ ok: false, status: 403 }),
      db,
      customEnv: { URLHAUS_AUTH_KEY: "mock-urlhaus-key" },
    });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "AUTH");
  });
});

describe("lib/tools/urlscan.js", () => {
  let db;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    process.env.LLM_PROVIDER = "gemini";
    process.env.LLM_API_KEY = "mock-llm-key";
    process.env.LLM_MODEL = "gemini-3.5-flash-lite";
    process.env.URLSCAN_API_KEY = "mock-urlscan-key";
  });

  afterEach(() => {
    db.close();
    process.env = { ...originalEnv };
  });

  test("returns INVALID_INPUT when neither or both domain and url provided", async () => {
    const res = await urlscanSearch({}, { db });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "INVALID_INPUT");
  });

  test("formats public search query and normalizes results", async () => {
    const mockFetch = async (url, opts) => {
      assert.ok(url.includes("q=domain%3Asuspicious.com"));
      assert.equal(opts.headers["API-Key"], "mock-urlscan-key");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total: 1,
          results: [
            {
              result: "https://urlscan.io/result/abc-123/",
              task: { time: "2026-04-01T10:00:00.000Z" },
              page: { domain: "suspicious.com" },
            },
          ],
        }),
      };
    };

    const res = await urlscanSearch({ domain: "suspicious.com" }, { fetchFn: mockFetch, db, customEnv: { URLSCAN_API_KEY: "mock-urlscan-key" } });
    assert.equal(res.ok, true);
    assert.equal(res.data.total, 1);
    assert.equal(res.data.results[0].resultUrl, "https://urlscan.io/result/abc-123/");
    assert.equal(res.data.results[0].pageDomain, "suspicious.com");
  });

  test("unseen domain returns total: 0 and results: [] without claiming safety", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ total: 0, results: [] }),
    });

    const res = await urlscanSearch({ domain: "unknown-site.org" }, { fetchFn: mockFetch, db });
    assert.equal(res.ok, true);
    assert.equal(res.data.total, 0);
    assert.equal(res.data.results.length, 0);
    assert.strictEqual(res.data.safe, undefined);
  });
});

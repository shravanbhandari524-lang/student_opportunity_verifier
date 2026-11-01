import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NAME,
  KIND,
  run as rawRun,
  websiteForensics,
  extractHost,
} from "../lib/agents/website-forensics.js";
import { routeMock } from "./helpers/tool-result-schemas.js";

const run = (snap, deps = {}, opts = {}) => {
  const routed = { ...deps };
  if (routed.rdapLookup) routed.rdapLookup = routeMock("rdapLookup", routed.rdapLookup);
  if (routed.dnsRecords) routed.dnsRecords = routeMock("dnsRecords", routed.dnsRecords);
  if (routed.sslInfo) routed.sslInfo = routeMock("sslInfo", routed.sslInfo);
  if (routed.waybackFirstSeen) routed.waybackFirstSeen = routeMock("waybackFirstSeen", routed.waybackFirstSeen);
  if (routed.lookalikeCheck) routed.lookalikeCheck = routeMock("lookalikeCheck", routed.lookalikeCheck);
  if (routed.urlhaus) routed.urlhaus = routeMock("urlhaus", routed.urlhaus);
  if (routed.urlscanSearch) routed.urlscanSearch = routeMock("urlscanSearch", routed.urlscanSearch);
  if (routed.readPage) routed.readPage = routeMock("readPage", routed.readPage);
  return rawRun(snap, routed, opts);
};

const noLookalike = () => ({
  isMatch: false,
  targetDomain: null,
  targetName: null,
  reason: null,
  confidence: null,
  method: null,
});

const unlistedUrlhaus = async () => ({
  ok: true,
  data: {
    listed: false,
    threat: null,
    urlStatus: null,
    dateAdded: null,
    tags: [],
    reference: null,
  },
});

function makeSnapshot({
  id = "22222222-2222-4222-8222-222222222222",
  round = 1,
  text = "",
  entities = [],
} = {}) {
  return {
    check: {
      id,
      status: "investigating",
      currentRound: round,
      language: "en",
      createdAt: "2026-10-30T00:00:00.000Z",
      expiresAt: "2026-10-31T00:00:00.000Z",
    },
    inputs: text ? [{ id: 1, checkId: id, type: "text", value: text }] : [],
    submission: text ? { text } : undefined,
    entities,
    findings: [],
    events: [],
    control: {
      processedEntitiesByAgent: {},
    },
  };
}

describe("L4 Website Forensics: Activity Log & Summary Across Audit Domains", () => {
  // Domain 1: google.com (old, legitimate)
  test("audit domain 1: google.com produces real facts in activity log and clean summary", async () => {
    const snap = makeSnapshot({
      text: "Search Google for opportunities: https://google.com",
      entities: [{ kind: "domain", value: "google.com" }],
    });

    const res = await run(snap, {
      rdapLookup: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: true,
          registrationDate: "1997-09-15T04:00:00.000Z",
          expirationDate: "2028-09-14T04:00:00.000Z",
          ageDays: 10636,
          registrar: "MarkMonitor Inc.",
          evidenceUrl: "https://rdap.org/domain/google.com",
          status: ["clientUpdateProhibited"],
        },
      }),
      dnsRecords: async (d) => ({
        ok: true,
        data: {
          domain: d,
          a: ["142.250.190.46"],
          aaaa: ["2607:f8b0:4005:808::200e"],
          mx: ["smtp.google.com"],
          txt: ["v=spf1 include:_spf.google.com ~all"],
          ns: ["ns1.google.com", "ns2.google.com"],
        },
      }),
      sslInfo: async (d) => ({
        ok: true,
        data: {
          domain: d,
          issuer: "Google Trust Services",
          subject: "*.google.com",
          validFrom: "2026-01-01T00:00:00.000Z",
          validTo: "2026-04-01T00:00:00.000Z",
          daysRemaining: 60,
          authorized: true,
          authError: null,
        },
      }),
      waybackFirstSeen: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: true,
          firstSeen: "1998-11-11T00:00:00.000Z",
          evidenceUrl: "https://web.archive.org/web/*/google.com",
        },
      }),
      lookalikeCheck: noLookalike,
      urlhaus: unlistedUrlhaus,
      readPage: async (url) => ({
        ok: true,
        data: {
          finalUrl: url,
          title: "Google",
          metaDescription: "Search the world's information",
          text: "Search Privacy Terms About",
          links: ["https://about.google", "https://policies.google.com/privacy"],
        },
      }),
    });

    assert.equal(res.status, "ok");
    assert.equal(res.flags.length, 0);
    assert.ok(res.summary, "Summary must be present");
    assert.ok(res.summary.includes("Checked 1 domain"), "Summary must state 1 domain checked");
    assert.ok(res.summary.includes("no red flags"), "Summary must state no red flags");
    assert.ok(res.summary.length <= 160, "Summary must be max 160 chars");

    // Check activity entries
    assert.ok(Array.isArray(res.activity) && res.activity.length > 0);
    const types = res.activity.map((a) => a.type);
    assert.ok(types.includes("input"), "Must have input entry");
    assert.ok(types.includes("step"), "Must have step entries");
    assert.ok(types.includes("verified"), "Must have verified entries");
    assert.ok(types.includes("manual"), "Must have manual verification recommendation");

    const tools = res.activity.map((a) => a.tool).filter(Boolean);
    assert.ok(tools.includes("rdap"), "Must have rdap step");
    assert.ok(tools.includes("dns"), "Must have dns step");
    assert.ok(tools.includes("ssl"), "Must have ssl step");
    assert.ok(tools.includes("wayback"), "Must have wayback step");
    assert.ok(tools.includes("rules"), "Must have rules step");
    assert.ok(tools.includes("fetch"), "Must have fetch step");

    const manualEntry = res.activity.find((a) => a.type === "manual");
    assert.ok(manualEntry.title.includes("letter by letter"), "Manual check must recommend letter by letter comparison");
  });

  // Domain 2: tcs.com (corporate recruiter)
  test("audit domain 2: tcs.com records age, SSL, and registrar facts without flags", async () => {
    const snap = makeSnapshot({
      text: "Careers at TCS: https://tcs.com",
      entities: [{ kind: "domain", value: "tcs.com" }],
    });

    const res = await run(snap, {
      rdapLookup: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: true,
          registrationDate: "1997-07-05T04:00:00.000Z",
          expirationDate: "2027-07-04T04:00:00.000Z",
          ageDays: 10565,
          registrar: "Sectigo Limited",
          evidenceUrl: "https://rdap.org/domain/tcs.com",
          status: ["clientTransferProhibited"],
        },
      }),
      dnsRecords: async (d) => ({
        ok: true,
        data: {
          domain: d,
          a: ["151.101.2.132"],
          aaaa: [],
          mx: ["mail.tcs.com"],
          txt: [],
          ns: [],
        },
      }),
      sslInfo: async (d) => ({
        ok: true,
        data: {
          domain: d,
          issuer: "Sectigo Limited",
          subject: "tcs.com",
          validFrom: "2026-01-01T00:00:00.000Z",
          validTo: "2026-07-01T00:00:00.000Z",
          daysRemaining: 150,
          authorized: true,
          authError: null,
        },
      }),
      waybackFirstSeen: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: true,
          firstSeen: "1997-07-05T00:00:00.000Z",
          evidenceUrl: "https://web.archive.org/web/*/tcs.com",
        },
      }),
      lookalikeCheck: noLookalike,
      urlhaus: unlistedUrlhaus,
      readPage: async (url) => ({
        ok: true,
        data: {
          finalUrl: url,
          title: "Tata Consultancy Services",
          metaDescription: "Global leader in IT services",
          text: "Careers Contact Us Privacy Policy Legal",
          links: ["https://tcs.com/privacy", "https://tcs.com/contact-us"],
        },
      }),
    });

    assert.equal(res.status, "ok");
    assert.equal(res.flags.length, 0);
    assert.ok(res.summary.includes("Checked 1 domain"));
    assert.ok(res.summary.includes("no red flags"));

    const rdapStep = res.activity.find((a) => a.tool === "rdap");
    assert.ok(rdapStep.detail.includes("Sectigo Limited"));
    assert.ok(rdapStep.detail.includes("10565 days") || rdapStep.detail.includes("days"));

    const dnsStep = res.activity.find((a) => a.tool === "dns");
    assert.ok(dnsStep.detail.includes("mail.tcs.com"));

    const fetchStep = res.activity.find((a) => a.tool === "fetch");
    assert.ok(fetchStep.detail.includes("Tata Consultancy Services"));
    assert.ok(fetchStep.detail.includes("contact and legal/privacy"));
  });

  // Domain 3: tcs-careers-india.in (lookalike affix)
  test("audit domain 3: tcs-careers-india.in records lookalike analysis in words and emits red flags", async () => {
    const snap = makeSnapshot({
      text: "Apply for TCS hiring at http://tcs-careers-india.in immediately",
      entities: [{ kind: "domain", value: "tcs-careers-india.in" }],
    });

    const res = await run(snap, {
      rdapLookup: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: false,
          registrationDate: null,
          expirationDate: null,
          ageDays: null,
          registrar: null,
          evidenceUrl: `https://rdap.org/domain/${d}`,
          status: [],
        },
      }),
      dnsRecords: async (d) => ({
        ok: true,
        data: {
          domain: d,
          a: ["103.21.244.0"],
          aaaa: [],
          mx: [],
          txt: [],
          ns: [],
        },
      }),
      sslInfo: async () => ({ ok: false, error: { code: "ECONNREFUSED", message: "port 443 closed" } }),
      waybackFirstSeen: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: false,
          firstSeen: null,
          evidenceUrl: null,
        },
      }),
      lookalikeCheck: () => ({
        isMatch: true,
        targetDomain: "tcs.com",
        targetName: "tcs",
        reason: "Contains protected brand token 'tcs' with recruiter affixes 'careers', 'india' but is not tcs.com",
        confidence: "high",
        method: "brand_token_affix",
      }),
      urlhaus: unlistedUrlhaus,
      readPage: async () => ({ ok: false, error: { code: "BLOCKED", message: "unreachable" } }),
    });

    assert.equal(res.status, "ok");
    assert.ok(res.flags.some((f) => f.id === "lookalike_domain"));
    assert.ok(res.flags.some((f) => f.id === "domain_no_history"));

    assert.ok(res.summary.includes("looks like a copy of tcs.com"));
    assert.ok(res.summary.includes("red flag"));

    // Check rules activity entry has lookalike analysis in words
    const rulesStep = res.activity.find((a) => a.tool === "rules" && a.status === "warn");
    assert.ok(rulesStep, "Must have warn rules step for lookalike");
    assert.ok(rulesStep.detail.includes("tcs"), "Must mention protected brand token");
    assert.ok(rulesStep.detail.includes("tcs.com"), "Must mention target domain");

    // Findings in activity
    const findingEntries = res.activity.filter((a) => a.type === "finding");
    assert.ok(findingEntries.length >= 2, "Must record findings for lookalike and no history");
  });

  // Domain 4: nonexistent-scholarship-portal-987654.com (NXDOMAIN)
  test("audit domain 4: nonexistent-scholarship-portal records DNS absence and generic words exclusion", async () => {
    const snap = makeSnapshot({
      text: "Check portal https://nonexistent-scholarship-portal-987654.com for updates",
      entities: [{ kind: "domain", value: "nonexistent-scholarship-portal-987654.com" }],
    });

    const res = await run(snap, {
      rdapLookup: async () => ({ ok: false, error: { code: "TIMEOUT", message: "timed out" } }),
      dnsRecords: async (d) => ({
        ok: true,
        data: {
          domain: d,
          a: [],
          aaaa: [],
          mx: [],
          txt: [],
          ns: [],
        },
      }),
      sslInfo: async () => ({ ok: false, error: { code: "ENOTFOUND", message: "NXDOMAIN" } }),
      waybackFirstSeen: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: false,
          firstSeen: null,
          evidenceUrl: null,
        },
      }),
      lookalikeCheck: noLookalike,
      urlhaus: unlistedUrlhaus,
      readPage: async () => ({ ok: false, error: { code: "ENOTFOUND", message: "Cannot resolve" } }),
    });

    assert.equal(res.status, "ok");
    const dnsStep = res.activity.find((a) => a.tool === "dns");
    assert.ok(dnsStep.detail.includes("No A (web) or MX (email) records") || dnsStep.title.includes("No records found"));
    assert.ok(dnsStep.detail.includes("domain may not exist"));

    const rulesStep = res.activity.find((a) => a.type === "step" && (a.title.includes("Rules") || a.title.includes("Generic")));
    assert.ok(rulesStep, "Must have rules step");
    assert.ok(rulesStep.detail.includes("generic opportunity term") || rulesStep.title.includes("Generic-word exclusions"));
  });

  // Domain 5: xn--ggle-55da.com (IDN Homograph Cyrillic gооgle.com)
  test("audit domain 5: xn--ggle-55da.com records Cyrillic homograph detection targeting google.com", async () => {
    const snap = makeSnapshot({
      text: "Login at https://xn--ggle-55da.com to continue",
      entities: [{ kind: "domain", value: "xn--ggle-55da.com" }],
    });

    const res = await run(snap, {
      rdapLookup: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: true,
          registrationDate: "2026-10-25T00:00:00.000Z",
          expirationDate: "2027-10-25T00:00:00.000Z",
          ageDays: 5,
          registrar: "Punycode Registrar",
          evidenceUrl: "https://rdap.org/domain/xn--ggle-55da.com",
          status: [],
        },
      }),
      dnsRecords: async (d) => ({
        ok: true,
        data: { domain: d, a: ["1.2.3.4"], aaaa: [], mx: [], txt: [], ns: [] },
      }),
      sslInfo: async (d) => ({
        ok: true,
        data: {
          domain: d,
          issuer: "Free CA",
          subject: "xn--ggle-55da.com",
          validFrom: "2026-10-25T00:00:00.000Z",
          validTo: "2027-01-25T00:00:00.000Z",
          daysRemaining: 86,
          authorized: true,
          authError: null,
        },
      }),
      waybackFirstSeen: async (d) => ({
        ok: true,
        data: { domain: d, found: false, firstSeen: null, evidenceUrl: null },
      }),
      lookalikeCheck: () => ({
        isMatch: true,
        targetDomain: "google.com",
        targetName: "google",
        reason: "Cyrillic homoglyph targeting google.com",
        confidence: "high",
        method: "homoglyph_skeleton",
      }),
      urlhaus: unlistedUrlhaus,
      readPage: async () => ({ ok: false, error: { code: "BLOCKED", message: "Blocked" } }),
    });

    assert.equal(res.status, "ok");
    assert.ok(res.flags.some((f) => f.id === "lookalike_domain"));

    const rulesStep = res.activity.find((a) => a.tool === "rules" && a.status === "warn");
    assert.ok(rulesStep.detail.includes("google.com"));

    // Check summary mentions copy
    assert.ok(res.summary.includes("looks like a copy of google.com"));
  });

  // Domain 6: scholarships.gov.in (authentic Indian Gov portal)
  test("audit domain 6: scholarships.gov.in applies generic word exclusion without false positive", async () => {
    const snap = makeSnapshot({
      text: "National Scholarship Portal: https://scholarships.gov.in",
      entities: [{ kind: "domain", value: "scholarships.gov.in" }],
    });

    const res = await run(snap, {
      rdapLookup: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: true,
          registrationDate: "2015-01-08T05:31:41.000Z",
          expirationDate: "2030-01-08T05:31:41.000Z",
          ageDays: 4312,
          registrar: "National Informatics Centre",
          evidenceUrl: "https://rdap.org/domain/scholarships.gov.in",
          status: [],
        },
      }),
      dnsRecords: async (d) => ({
        ok: true,
        data: {
          domain: d,
          a: ["164.100.137.147"],
          aaaa: [],
          mx: ["mail.gov.in"],
          txt: [],
          ns: [],
        },
      }),
      sslInfo: async (d) => ({
        ok: true,
        data: {
          domain: d,
          issuer: "eMudhra Technologies Limited",
          subject: "scholarships.gov.in",
          validFrom: "2025-01-01T00:00:00.000Z",
          validTo: "2027-01-01T00:00:00.000Z",
          daysRemaining: 400,
          authorized: true,
          authError: null,
        },
      }),
      waybackFirstSeen: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: true,
          firstSeen: "2016-07-12T00:00:00.000Z",
          evidenceUrl: "https://web.archive.org/web/*/scholarships.gov.in",
        },
      }),
      lookalikeCheck: noLookalike,
      urlhaus: unlistedUrlhaus,
      readPage: async (url) => ({
        ok: true,
        data: {
          finalUrl: url,
          title: "National Scholarship Portal",
          metaDescription: "Government of India scholarships portal",
          text: "National Scholarship Portal Ministry of Electronics and IT Contact Us Privacy Policy",
          links: ["https://scholarships.gov.in/contactUs"],
        },
      }),
    });

    assert.equal(res.status, "ok");
    assert.equal(res.flags.length, 0);

    const rulesStep = res.activity.find((a) => a.type === "step" && (a.title.includes("Rules") || a.title.includes("Generic")));
    assert.ok(rulesStep, "Must have rules step");
    assert.ok(rulesStep.detail.includes("generic opportunity term") || rulesStep.title.includes("Generic-word exclusions"));
    assert.ok(res.summary.includes("no red flags"));
  });

  // Domain 7: https://tinyurl.com/app (URL shortener)
  test("audit domain 7: url shortener records redirect target in activity log", async () => {
    const snap = makeSnapshot({
      text: "Apply via link: https://tinyurl.com/app",
      entities: [{ kind: "url", value: "https://tinyurl.com/app" }],
    });

    const res = await run(snap, {
      rdapLookup: async (d) => ({
        ok: true,
        data: {
          domain: d,
          found: true,
          registrationDate: "2002-02-12T00:00:00.000Z",
          expirationDate: "2028-02-12T00:00:00.000Z",
          ageDays: 9041,
          registrar: "Namecheap",
          evidenceUrl: "https://rdap.org/domain/tinyurl.com",
          status: [],
        },
      }),
      dnsRecords: async (d) => ({
        ok: true,
        data: { domain: d, a: ["104.16.1.1"], aaaa: [], mx: [], txt: [], ns: [] },
      }),
      sslInfo: async (d) => ({
        ok: true,
        data: {
          domain: d,
          issuer: "Cloudflare",
          subject: "tinyurl.com",
          validFrom: "2026-01-01T00:00:00.000Z",
          validTo: "2026-06-01T00:00:00.000Z",
          daysRemaining: 100,
          authorized: true,
          authError: null,
        },
      }),
      waybackFirstSeen: async (d) => ({
        ok: true,
        data: { domain: d, found: true, firstSeen: "2002-02-12T00:00:00.000Z", evidenceUrl: null },
      }),
      lookalikeCheck: noLookalike,
      urlhaus: unlistedUrlhaus,
      readPage: async () => ({
        ok: true,
        data: {
          finalUrl: "https://target-organization.com/internship-apply",
          title: "Internship Application Portal",
          metaDescription: "Apply for summer internships",
          text: "Welcome to application portal Contact Us Privacy",
          links: ["https://target-organization.com/contact"],
          redirectChain: ["https://tinyurl.com/app", "https://target-organization.com/internship-apply"],
        },
      }),
    });

    assert.equal(res.status, "ok");

    // Verify that redirect target was captured as an input / redirect entry
    const redirectInput = res.activity.find((a) => a.title.includes("Redirect target"));
    assert.ok(redirectInput, "Redirect target must be recorded in activity entries");
    assert.ok(redirectInput.detail.includes("https://target-organization.com/internship-apply"));
  });

  // Domain 8: http://93.184.216.34 (raw IP URL)
  test("audit domain 8: raw IP URL records IP step, raw_ip flag, and manual check", async () => {
    const snap = makeSnapshot({
      text: "Upload resume to http://93.184.216.34/job for instant selection",
      entities: [{ kind: "url", value: "http://93.184.216.34/job" }],
    });

    const res = await run(snap, {
      sslInfo: async () => ({ ok: false, error: { code: "ECONNREFUSED", message: "port 443 closed" } }),
      readPage: async () => ({
        ok: true,
        data: {
          finalUrl: "http://93.184.216.34/job",
          title: "Job Upload",
          metaDescription: "",
          text: "Upload your resume",
          links: [],
        },
      }),
    });

    assert.equal(res.status, "ok");
    assert.ok(res.flags.some((f) => f.id === "raw_ip_opportunity_link"));
    assert.ok(res.summary.includes("raw IP address"));
    assert.ok(res.summary.includes("1 red flag"));

    const ipStep = res.activity.find((a) => a.title.includes("Raw IP address target"));
    assert.ok(ipStep, "Activity must contain raw IP detection step");

    const manualEntry = res.activity.find((a) => a.type === "manual");
    assert.ok(manualEntry.detail.includes("93.184.216.34"));
  });

  // Domain 9: http://nxdomain-down-site-999.com (site completely down)
  test("audit domain 9: site completely down records failure limits and plain reasons", async () => {
    const snap = makeSnapshot({
      text: "Site: http://nxdomain-down-site-999.com",
      entities: [{ kind: "domain", value: "nxdomain-down-site-999.com" }],
    });

    const res = await run(snap, {
      rdapLookup: async () => ({ ok: false, error: { code: "TIMEOUT", message: "RDAP connection timed out" } }),
      dnsRecords: async (d) => ({
        ok: true,
        data: { domain: d, a: [], aaaa: [], mx: [], txt: [], ns: [] },
      }),
      sslInfo: async () => ({ ok: false, error: { code: "ECONNREFUSED", message: "Connection refused" } }),
      waybackFirstSeen: async (d) => ({
        ok: true,
        data: { domain: d, found: false, firstSeen: null, evidenceUrl: null },
      }),
      lookalikeCheck: noLookalike,
      urlhaus: unlistedUrlhaus,
      readPage: async () => ({ ok: false, error: { code: "NETWORK", message: "Host unreachable" } }),
    });

    assert.equal(res.status, "ok");
    assert.ok(res.flags.some((f) => f.id === "domain_no_history"));

    const limits = res.activity.filter((a) => a.type === "limit");
    assert.ok(limits.length >= 3, "Must have limits for RDAP, DNS, SSL, and fetch");
    const rdapLimit = limits.find((l) => l.tool === "rdap");
    assert.ok(rdapLimit.detail.includes("RDAP connection timed out") || rdapLimit.title.includes("RDAP"));

    const dnsStep = res.activity.find((a) => a.tool === "dns");
    assert.ok(dnsStep.detail.includes("domain may not exist"));
  });
});

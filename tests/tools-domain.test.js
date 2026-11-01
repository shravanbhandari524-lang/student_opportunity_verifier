/**
 * tests/tools-domain.test.js
 *
 * Comprehensive offline unit tests for domain intelligence, lookalike detection,
 * payments fact extraction, and caching.
 * Stubs global fetch and uses mock modules. NO network access.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { isGovIn, rdapLookup, dnsRecords, sslInfo, waybackFirstSeen } from "../lib/tools/domain.js";
import { checkDomainLookalike, levenshteinDistance, visualSkeleton } from "../lib/tools/lookalike.js";
import { upiFacts, emailFacts, phoneFacts } from "../lib/tools/payments.js";
import { getDb } from "../lib/db/index.js";

// Ensure global fetch is never called during tests
globalThis.fetch = () => {
  throw new Error("Network access forbidden in offline tests: global.fetch was called!");
};

test("domain - isGovIn correctly identifies authentic Indian government domains", () => {
  assert.equal(isGovIn("scholarships.gov.in"), true);
  assert.equal(isGovIn("mhrd.gov.in"), true);
  assert.equal(isGovIn("nta.nic.in"), true);
  assert.equal(isGovIn("sub.portal.gov.in"), true);

  // Fake or non-gov
  assert.equal(isGovIn("gov.in.fake-portal.com"), false);
  assert.equal(isGovIn("scholarship-gov.in"), false);
  assert.equal(isGovIn("ugc.ac.in"), false);
  assert.equal(isGovIn("example.com"), false);
  assert.equal(isGovIn(""), false);
});

test("domain - rdapLookup parses RFC 9083 registration date, registrar, age, and caches result", async () => {
  const db = getDb(":memory:");

  let fetchCount = 0;
  const mockFetch = async (url) => {
    fetchCount++;
    assert.ok(url.includes("example.com"));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        events: [
          { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
          { eventAction: "expiration", eventDate: "2030-08-13T04:00:00Z" },
        ],
        entities: [
          {
            roles: ["registrar"],
            vcardArray: ["vcard", [["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"]]],
          },
        ],
        status: ["client transfer prohibited"],
      }),
    };
  };

  // First call: executes fetch
  const res1 = await rdapLookup("example.com", { fetchFn: mockFetch, db });
  assert.equal(res1.ok, true);
  assert.equal(res1.data.found, true);
  assert.equal(res1.data.domain, "example.com");
  assert.equal(res1.data.registrationDate, "1995-08-14T04:00:00Z");
  assert.ok(res1.data.ageDays > 10000);
  assert.equal(res1.data.registrar, "RESERVED-Internet Assigned Numbers Authority");
  assert.equal(res1.cached, false);
  assert.equal(fetchCount, 1);

  // Second call: served from lookup_cache
  const res2 = await rdapLookup("example.com", { fetchFn: mockFetch, db });
  assert.equal(res2.ok, true);
  assert.equal(res2.cached, true);
  assert.equal(res2.data.registrationDate, "1995-08-14T04:00:00Z");
  assert.equal(fetchCount, 1); // No new network call
});

test("domain - rdapLookup handles 404 domain not found cleanly", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 404,
  });

  const res = await rdapLookup("nonexistent-domain-12345.com", { fetchFn: mockFetch });
  assert.equal(res.ok, true);
  assert.equal(res.data.found, false);
  assert.equal(res.data.registrationDate, null);
  assert.equal(res.data.ageDays, null);
});

test("domain - rdapLookup handles 429 rate limit, timeouts, and TLDs without RDAP (501/503)", async () => {
  // 429 rate limited
  const mockFetch429 = async () => ({
    ok: false,
    status: 429,
  });
  const res429 = await rdapLookup("busy.example", { fetchFn: mockFetch429 });
  assert.equal(res429.ok, false);
  assert.equal(res429.error.code, "RATE_LIMITED");

  // Timeout
  const mockFetchTimeout = async () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    throw err;
  };
  const resTimeout = await rdapLookup("slow.example", { fetchFn: mockFetchTimeout });
  assert.equal(resTimeout.ok, false);
  assert.equal(resTimeout.error.code, "TIMEOUT");

  // TLD without RDAP server (e.g. 501 Not Implemented or 503)
  const mockFetchNoRdap = async () => ({
    ok: false,
    status: 501,
  });
  const resNoRdap = await rdapLookup("unsupported.tld", { fetchFn: mockFetchNoRdap });
  assert.equal(resNoRdap.ok, false);
  assert.equal(resNoRdap.error.code, "UPSTREAM_ERROR");
});

test("domain - dnsRecords queries DNS records and caches result", async () => {
  const db = getDb(":memory:");

  let queryCount = 0;
  const mockDns = {
    resolve4: async () => {
      queryCount++;
      return ["93.184.216.34"];
    },
    resolve6: async () => ["2606:2800:220:1:248:1893:25c8:1946"],
    resolveMx: async () => [{ priority: 10, exchange: "mail.example.com" }],
    resolveNs: async () => ["a.iana-servers.net", "b.iana-servers.net"],
    resolveTxt: async () => [["v=spf1 -all"]],
  };

  const res1 = await dnsRecords("example.com", { dnsModule: mockDns, db });
  assert.equal(res1.ok, true);
  assert.deepEqual(res1.data.a, ["93.184.216.34"]);
  assert.deepEqual(res1.data.mx, ["10 mail.example.com"]);
  assert.deepEqual(res1.data.txt, ["v=spf1 -all"]);
  assert.equal(res1.cached, false);
  assert.equal(queryCount, 1);

  // Cached call
  const res2 = await dnsRecords("example.com", { dnsModule: mockDns, db });
  assert.equal(res2.ok, true);
  assert.equal(res2.cached, true);
  assert.equal(queryCount, 1);
});

test("domain - sslInfo extracts certificate validity, issuer, and days remaining", async () => {
  const fakeCert = {
    issuer: { O: "DigiCert Inc", CN: "DigiCert Global G2 TLS RSA SHA256 2020 CA1" },
    subject: { CN: "example.com" },
    valid_from: "2024-01-01T00:00:00.000Z",
    valid_to: "2027-01-01T00:00:00.000Z",
  };

  const mockTls = {
    connect: (options, onConnect) => {
      assert.equal(options.servername, "example.com");
      const socket = {
        getPeerCertificate: () => fakeCert,
        authorized: true,
        authorizationError: null,
        end: () => {},
        on: () => socket,
      };
      setImmediate(onConnect);
      return socket;
    },
  };

  const res = await sslInfo("example.com", { pinnedIp: "93.184.216.34", tlsModule: mockTls });
  assert.equal(res.ok, true);
  assert.equal(res.data.issuer, "DigiCert Inc");
  assert.equal(res.data.authorized, true);
  assert.ok(res.data.daysRemaining > 0);
});

test("domain - sslInfo handles expired certificate, hostname mismatch, and self-signed", async () => {
  // Expired certificate
  const expiredCert = {
    issuer: { O: "Let's Encrypt", CN: "R3" },
    subject: { CN: "expired.example" },
    valid_from: "2020-01-01T00:00:00.000Z",
    valid_to: "2020-04-01T00:00:00.000Z",
  };
  const mockTlsExpired = {
    connect: (_opts, onConnect) => {
      const socket = {
        getPeerCertificate: () => expiredCert,
        authorized: false,
        authorizationError: "CERT_HAS_EXPIRED",
        end: () => {},
        on: () => socket,
      };
      setImmediate(onConnect);
      return socket;
    },
  };
  const resExpired = await sslInfo("expired.example", { tlsModule: mockTlsExpired });
  assert.equal(resExpired.ok, true);
  assert.equal(resExpired.data.authorized, false);
  assert.equal(resExpired.data.authError, "CERT_HAS_EXPIRED");
  assert.ok(resExpired.data.daysRemaining < 0);

  // Hostname mismatch
  const mismatchCert = {
    issuer: { O: "DigiCert Inc", CN: "DigiCert" },
    subject: { CN: "other-domain.example" },
    valid_from: "2024-01-01T00:00:00.000Z",
    valid_to: "2026-01-01T00:00:00.000Z",
  };
  const mockTlsMismatch = {
    connect: (_opts, onConnect) => {
      const socket = {
        getPeerCertificate: () => mismatchCert,
        authorized: false,
        authorizationError: "ERR_TLS_CERT_ALTNAME_INVALID",
        end: () => {},
        on: () => socket,
      };
      setImmediate(onConnect);
      return socket;
    },
  };
  const resMismatch = await sslInfo("mismatch.example", { tlsModule: mockTlsMismatch });
  assert.equal(resMismatch.ok, true);
  assert.equal(resMismatch.data.authorized, false);
  assert.equal(resMismatch.data.authError, "ERR_TLS_CERT_ALTNAME_INVALID");

  // Self-signed certificate
  const selfSignedCert = {
    issuer: { O: "SelfSigned", CN: "self-signed.example" },
    subject: { CN: "self-signed.example" },
    valid_from: "2025-01-01T00:00:00.000Z",
    valid_to: "2028-01-01T00:00:00.000Z",
  };
  const mockTlsSelf = {
    connect: (_opts, onConnect) => {
      const socket = {
        getPeerCertificate: () => selfSignedCert,
        authorized: false,
        authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
        end: () => {},
        on: () => socket,
      };
      setImmediate(onConnect);
      return socket;
    },
  };
  const resSelf = await sslInfo("self-signed.example", { tlsModule: mockTlsSelf });
  assert.equal(resSelf.ok, true);
  assert.equal(resSelf.data.authorized, false);
  assert.equal(resSelf.data.authError, "DEPTH_ZERO_SELF_SIGNED_CERT");
});

test("domain - waybackFirstSeen parses CDX snapshot, and handles 429, timeout, empty body, and never-archived domain", async () => {
  // Scenario 1: Snapshot exists
  const mockFetchFound = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([
      ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
      ["org,example)/", "20020120142510", "http://example.com:80/", "text/html", "200", "DIGEST", "1234"],
    ]),
  });

  const resFound = await waybackFirstSeen("example.com", { fetchFn: mockFetchFound });
  assert.equal(resFound.ok, true);
  assert.equal(resFound.data.found, true);
  assert.equal(resFound.data.firstSeen, "2002-01-20");
  assert.ok(resFound.data.evidenceUrl.includes("20020120142510"));

  // Scenario 2: Never archived domain (headers only in CDX response)
  const mockFetchNotFound = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([
      ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"],
    ]),
  });

  const resNotFound = await waybackFirstSeen("brand-new-scam-domain.xyz", { fetchFn: mockFetchNotFound });
  assert.equal(resNotFound.ok, true);
  assert.equal(resNotFound.data.found, false);
  assert.equal(resNotFound.data.firstSeen, null);

  // Scenario 3: Empty response body
  const mockFetchEmpty = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
  });
  const resEmpty = await waybackFirstSeen("empty-body.example", { fetchFn: mockFetchEmpty });
  assert.equal(resEmpty.ok, true);
  assert.equal(resEmpty.data.found, false);

  // Scenario 4: Rate limited (429)
  const mockFetch429 = async () => ({
    ok: false,
    status: 429,
  });
  const res429 = await waybackFirstSeen("rate-limited.example", { fetchFn: mockFetch429 });
  assert.equal(res429.ok, false);
  assert.equal(res429.error.code, "RATE_LIMITED");

  // Scenario 5: Timeout
  const mockFetchTimeout = async () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    throw err;
  };
  const resTimeout = await waybackFirstSeen("timeout.example", { fetchFn: mockFetchTimeout });
  assert.equal(resTimeout.ok, false);
  assert.equal(resTimeout.error.code, "TIMEOUT");
});

test("caching invariant: failures are NEVER cached; second call after a failure makes a new request", async () => {
  const db = getDb(":memory:");

  let attempt = 0;
  const mockFetch = async () => {
    attempt++;
    if (attempt === 1) {
      // First attempt fails with 500 UPSTREAM_ERROR
      return { ok: false, status: 500 };
    }
    // Second attempt recovers
    return {
      ok: true,
      status: 200,
      json: async () => ({
        events: [{ eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" }],
        entities: [{ roles: ["registrar"], handle: "TEST-REGISTRAR" }],
        status: ["active"],
      }),
    };
  };

  const res1 = await rdapLookup("retry-test.example", { fetchFn: mockFetch, db });
  assert.equal(res1.ok, false);
  assert.equal(res1.error.code, "UPSTREAM_ERROR");
  assert.equal(attempt, 1);

  // Second call must NOT be served from cache; it must execute fresh request
  const res2 = await rdapLookup("retry-test.example", { fetchFn: mockFetch, db });
  assert.equal(res2.ok, true);
  assert.equal(res2.cached, false);
  assert.equal(res2.data.found, true);
  assert.equal(attempt, 2);
});

test("lookalike - detects homoglyphs, typos, brand affixes, and ignores authentic domains", () => {
  // Levenshtein & skeleton helpers
  assert.equal(levenshteinDistance("internshala", "internshala"), 0);
  assert.equal(levenshteinDistance("internshala", "internshala1"), 1);
  assert.equal(visualSkeleton("interrnsha1a"), "lntermshala");

  // Rule 1: Homoglyph skeleton match (rn -> m)
  const homoglyph = checkDomainLookalike("inte-rnshala.com");
  assert.equal(homoglyph.isMatch, true);
  assert.equal(homoglyph.targetDomain, "internshala.com");
  assert.equal(homoglyph.method, "homoglyph_skeleton");

  // Rule 2: Suspicious token affixing: "iitb-gov.in" targeting "iitb.ac.in"
  const affix = checkDomainLookalike("iitb-gov.in");
  assert.equal(affix.isMatch, true);
  assert.equal(affix.targetDomain, "iitb.ac.in");
  assert.equal(affix.method, "brand_token_affix");

  // Rule 3: TLD spoofing: "infosys.xyz" targeting "infosys.com"
  const tldSpoof = checkDomainLookalike("infosys.xyz");
  assert.equal(tldSpoof.isMatch, true);
  assert.equal(tldSpoof.targetDomain, "infosys.com");
  assert.equal(tldSpoof.method, "tld_spoofing");

  // Rule 4: Edit distance typo (distance 1): "budd4study.com" targeting "buddy4study.com"
  const typo = checkDomainLookalike("budd4study.com");
  assert.equal(typo.isMatch, true);
  assert.equal(typo.targetDomain, "buddy4study.com");
  assert.equal(typo.method, "edit_distance");

  // Negatives 1: Exact match of a known domain is NOT a lookalike match
  const genuineExact = checkDomainLookalike("aicte-india.org");
  assert.equal(genuineExact.isMatch, false);

  // Negatives 2: True subdomain of a known domain is NOT a lookalike match
  const genuineSub = checkDomainLookalike("internship.aicte-india.org");
  assert.equal(genuineSub.isMatch, false);

  // Negatives 3: Completely unrelated public domain
  const unrelated = checkDomainLookalike("wikipedia.org");
  assert.equal(unrelated.isMatch, false);

  // Audit-mandated Lookalike tests
  // 1. Tokenized brand + extra words (hyphens and labels)
  const tcsAffix = checkDomainLookalike("tcs-careers-india.in");
  assert.equal(tcsAffix.isMatch, true);
  assert.equal(tcsAffix.targetDomain, "tcs.com");

  const infosysAffix = checkDomainLookalike("infosys-careers-portal-india.com");
  assert.equal(infosysAffix.isMatch, true);
  assert.equal(infosysAffix.targetDomain, "infosys.com");

  // 2. Punycode and Unicode Cyrillic homoglyphs
  const punycodeGoogle = checkDomainLookalike("xn--ggle-55da.com");
  assert.equal(punycodeGoogle.isMatch, true);
  assert.equal(punycodeGoogle.targetDomain, "google.com");

  const cyrillicGoogle = checkDomainLookalike("g\u043E\u043Egle.com"); // gооgle.com with Cyrillic small letter o
  assert.equal(cyrillicGoogle.isMatch, true);
  assert.equal(cyrillicGoogle.targetDomain, "google.com");

  // 3. Legitimate domains must not be flagged
  assert.equal(checkDomainLookalike("tcs.com").isMatch, false);
  assert.equal(checkDomainLookalike("scholarships.gov.in").isMatch, false);

  // 4. Generic dictionary words must NOT be flagged under alternative TLDs
  assert.equal(checkDomainLookalike("scholarships.com").isMatch, false);
  assert.equal(checkDomainLookalike("education.com").isMatch, false);
});

test("payments - upiFacts extracts handle, PSP name, bank, and flags personal phone numbers", () => {
  const gpay = upiFacts("student.aid@okaxis");
  assert.equal(gpay.valid, true);
  assert.equal(gpay.username, "student.aid");
  assert.equal(gpay.handle, "okaxis");
  assert.equal(gpay.isKnownPsp, true);
  assert.equal(gpay.pspName, "Google Pay");
  assert.equal(gpay.bankName, "Axis Bank");
  assert.equal(gpay.looksLikePhone, false);

  // Phone number username on PhonePe
  const phoneUpi = upiFacts("9876543210@ybl");
  assert.equal(phoneUpi.valid, true);
  assert.equal(phoneUpi.username, "9876543210");
  assert.equal(phoneUpi.handle, "ybl");
  assert.equal(phoneUpi.pspName, "PhonePe");
  assert.equal(phoneUpi.looksLikePhone, true);

  // Invalid UPI format
  const invalid = upiFacts("not-a-upi");
  assert.equal(invalid.valid, false);

  // Email address with dot in handle must be rejected as invalid UPI
  const emailAsUpi = upiFacts("user@gmail.com");
  assert.equal(emailAsUpi.valid, false, "Email address with domain dot must not be accepted as UPI");
  const eduEmail = upiFacts("admissions@iitb.ac.in");
  assert.equal(eduEmail.valid, false, "Domain with dot must not be accepted as UPI");
});

test("payments - emailFacts extracts domain, classifies free providers and edu/gov", () => {
  const free = emailFacts("scholarship.verify@gmail.com");
  assert.equal(free.valid, true);
  assert.equal(free.domain, "gmail.com");
  assert.equal(free.isFreeProvider, true);
  assert.equal(free.isEduOrGov, false);

  const gov = emailFacts("desk@mhrd.gov.in");
  assert.equal(gov.valid, true);
  assert.equal(gov.domain, "mhrd.gov.in");
  assert.equal(gov.isFreeProvider, false);
  assert.equal(gov.isEduOrGov, true);

  const edu = emailFacts("dean@iitb.ac.in");
  assert.equal(edu.valid, true);
  assert.equal(edu.isFreeProvider, false);
  assert.equal(edu.isEduOrGov, true);

  const invalid = emailFacts("bad-email");
  assert.equal(invalid.valid, false);
});

test("payments - phoneFacts parses E.164 without attempting personal identification", () => {
  // Valid Indian mobile (+91)
  const indianMobile = phoneFacts("+919876543210");
  assert.equal(indianMobile.valid, true);
  assert.equal(indianMobile.country, "IN");
  assert.equal(indianMobile.countryCallingCode, "91");
  assert.equal(indianMobile.nationalNumber, "9876543210");

  // Invalid E.164 (too short or missing plus)
  const badPhone = phoneFacts("9876543210");
  assert.equal(badPhone.valid, false);
});

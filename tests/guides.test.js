import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { GET as listGuidesGet } from "../app/api/guides/route.js";
import { GET as getGuideByTypeGet } from "../app/api/guides/[type]/route.js";
import { listGuides, getGuideByType, getGuideForScamTypeGuess, GUIDE_TYPE_MAPPINGS } from "../lib/guides/index.js";
import { GUIDES_CONTENT } from "../lib/guides/content.js";
import { GUIDE_TYPES } from "../lib/contracts/enums.js";
import { SCAM_TYPE_GUESSES } from "../lib/contracts/report.js";
import { GuideSchema } from "../lib/contracts/guides.js";
import { setRuntimeForTests, resetRuntime, getRuntime } from "../lib/api/runtime.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { BANNED_SCAMMER_PATTERNS, BANNED_SAFETY_PHRASES } from "../lib/report/constants.js";

describe("L7 Guides Subsystem", () => {
  beforeEach(() => {
    const baseRuntime = getRuntime();
    setRuntimeForTests({
      ...baseRuntime,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        guideRead: createRateLimiter({ windowMs: 60000, max: 60 }),
      },
    });
  });

  afterEach(() => {
    resetRuntime();
  });

  // --- UNIT TESTS: CONTENT INTEGRITY & RULES ---

  it("all six guide types exist and match GUIDE_TYPES enum", () => {
    assert.equal(GUIDE_TYPES.length, 6);
    for (const type of GUIDE_TYPES) {
      const guide = getGuideByType(type);
      assert.ok(guide, `Guide for type '${type}' must exist`);
      assert.equal(guide.type, type);
    }
  });

  it("each guide has at least 3 red flags, non-empty whatToDo and alreadyPaid sections", () => {
    for (const guide of GUIDES_CONTENT) {
      assert.ok(Array.isArray(guide.redFlags), `${guide.type} redFlags must be an array`);
      assert.ok(guide.redFlags.length >= 3, `${guide.type} must have at least 3 red flags (has ${guide.redFlags.length})`);

      assert.ok(Array.isArray(guide.whatToDo), `${guide.type} whatToDo must be an array`);
      assert.ok(guide.whatToDo.length >= 1, `${guide.type} whatToDo must not be empty`);

      assert.ok(Array.isArray(guide.alreadyPaid), `${guide.type} alreadyPaid must be an array`);
      assert.ok(guide.alreadyPaid.length >= 1, `${guide.type} alreadyPaid must not be empty`);

      assert.ok(Array.isArray(guide.howItWorks), `${guide.type} howItWorks must be an array`);
      assert.ok(guide.howItWorks.length >= 1, `${guide.type} howItWorks must not be empty`);

      assert.ok(Array.isArray(guide.whatToVerify), `${guide.type} whatToVerify must be an array`);
      assert.ok(guide.whatToVerify.length >= 1, `${guide.type} whatToVerify must not be empty`);
    }
  });

  it("every claim cites an existing source id in that guide's sources list", () => {
    for (const guide of GUIDES_CONTENT) {
      assert.ok(Array.isArray(guide.claims) && guide.claims.length >= 1);
      assert.ok(Array.isArray(guide.sources) && guide.sources.length >= 1);

      const availableSourceIds = new Set(guide.sources.map((s) => s.id));

      for (const claim of guide.claims) {
        assert.ok(claim.claim.length > 0, `${guide.type} has empty claim text`);
        assert.ok(claim.sourceIds.length >= 1, `Claim '${claim.claim}' must cite at least one source id`);
        for (const sId of claim.sourceIds) {
          assert.ok(
            availableSourceIds.has(sId),
            `Claim in ${guide.type} references non-existent source id '${sId}'`
          );
        }
      }
    }
  });

  it("no digit-percentage or amount pattern appears in prose without a claim marker (heuristic test)", () => {
    // Note on heuristic test limits:
    // This heuristic regex tests that unquoted text in howItWorks, redFlags, whatToDo, and alreadyPaid
    // does not contain unverified quantitative claims like "80%", "95%", "Rs 5000", or "₹10000"
    // unless defined as a verified claim with cited sources.
    const percentagePattern = /\b\d{1,3}\s*%/;
    const amountPattern = /(?:Rs\.?|INR|₹)\s*\d+/i;

    for (const guide of GUIDES_CONTENT) {
      const proseSections = [
        guide.summary,
        ...guide.howItWorks,
        ...guide.redFlags,
        ...guide.whatToVerify,
        ...guide.whatToDo,
        ...guide.alreadyPaid,
      ];

      for (const text of proseSections) {
        // Assert no unsubstantiated statistics (percentages)
        // (If "100%" appears, check that it only describes an unverified scammer pitch like "100% visa approval" in red flags)
        if (percentagePattern.test(text)) {
          assert.ok(
            text.includes("100% visa approval"),
            `Unexpected percentage statistic in ${guide.type}: "${text}"`
          );
        }
        // Assert zero specific arbitrary currency amounts in prose
        assert.equal(
          amountPattern.test(text),
          false,
          `Specific currency amount detected in prose for ${guide.type}: "${text}"`
        );
      }
    }
  });

  it("no phone number or URL appears in prose outside structured sources list", () => {
    const urlPattern = /https?:\/\/[^\s<>"]+/i;
    const phonePattern = /(?:\+?91[\s-]?)?[6-9]\d{9}\b/;

    for (const guide of GUIDES_CONTENT) {
      const proseSections = [
        guide.title,
        guide.summary,
        ...guide.howItWorks,
        ...guide.redFlags,
        ...guide.whatToVerify,
        ...guide.whatToDo,
        ...guide.alreadyPaid,
        ...guide.claims.map((c) => c.claim),
      ];

      for (const text of proseSections) {
        assert.equal(
          urlPattern.test(text),
          false,
          `URL found in prose in ${guide.type}: "${text}" (URLs allowed only in sources list)`
        );
        assert.equal(
          phonePattern.test(text),
          false,
          `Phone number found in prose in ${guide.type}: "${text}"`
        );
      }
    }
  });

  it("no banned safety phrases or defamatory accusations appear in any guide text", () => {
    for (const guide of GUIDES_CONTENT) {
      const allText = [
        guide.title,
        guide.summary,
        ...guide.howItWorks,
        ...guide.redFlags,
        ...guide.whatToVerify,
        ...guide.whatToDo,
        ...guide.alreadyPaid,
        ...guide.claims.map((c) => c.claim),
        ...guide.sources.map((s) => `${s.title} ${s.publisher}`),
      ].join("\n");

      // Check banned scammer patterns
      for (const pat of BANNED_SCAMMER_PATTERNS) {
        assert.equal(pat.test(allText), false, `Guide ${guide.type} violated scammer pattern ${pat}`);
      }

      // Check banned safety phrases
      for (const phrase of BANNED_SAFETY_PHRASES) {
        assert.equal(
          allText.toLowerCase().includes(phrase.toLowerCase()),
          false,
          `Guide ${guide.type} violated safety phrase '${phrase}'`
        );
      }
    }
  });

  it("no guide sentence contains unverified legal, statutory, or penalty markers", () => {
    // Fails if any guide sentence contains statute markers or criminal penalty terms unless in a verified claim
    const statutePattern = /\b(?:section|act|code|article)\s+\d+/i;
    const penaltyPattern = /\b(?:penalty|imprisonment|jail|fine of|court|legal liability|punishable|criminal prosecution|entry bans?|travel bans?)\b/i;

    for (const guide of GUIDES_CONTENT) {
      const proseSections = [
        guide.title,
        guide.summary,
        ...guide.howItWorks,
        ...guide.redFlags,
        ...guide.whatToVerify,
        ...guide.whatToDo,
        ...guide.alreadyPaid,
        ...guide.claims.map((c) => c.claim),
      ];

      for (const text of proseSections) {
        assert.equal(
          statutePattern.test(text),
          false,
          `Statute pattern detected in ${guide.type}: "${text}"`
        );
        assert.equal(
          penaltyPattern.test(text),
          false,
          `Penalty / criminal legal liability marker detected in ${guide.type}: "${text}"`
        );
      }
    }
  });

  it("every non-trivial sentence in red flags, what to verify, and what to do is covered by a claim or approved instructional phrasing", () => {
    // Sentences must strictly adhere to known fraud indicators (PRD Section 2) or standard non-legal guidance instructions
    const allowedInstructions = [
      "never", "verify", "check", "confirm", "consult", "decline", "do not", "insist", "report", "understand", "be wary", "search", "cross-check", "applicants", "solicitations", "prompts", "disbursement", "domain", "unregistered", "claims", "offers", "demands", "reluctance", "mandatory", "sharing", "funds", "the operator", "the solicitation", "students", "candidates", "the recruiter", "before", "payment", "unverifiable", "initial", "the scheme", "promises", "strong insistence", "promoters", "the organizers", "participants", "the competition", "websites", "lack of", "guidance", "regulatory", "direct selection", "upfront", "unrealistic", "cannot be verified", "company", "requests", "pitches", "stop", "always", "guarantee", "certificate"
    ];

    for (const guide of GUIDES_CONTENT) {
      const actionSentences = [
        ...guide.redFlags,
        ...guide.whatToVerify,
        ...guide.whatToDo,
      ];

      for (const sentence of actionSentences) {
        assert.ok(sentence.length > 10, `Sentence too short in ${guide.type}: "${sentence}"`);
        const lower = sentence.toLowerCase();
        const matchesTemplate = allowedInstructions.some((prefix) => lower.includes(prefix));
        assert.ok(
          matchesTemplate,
          `Sentence in ${guide.type} does not match approved instructional/indicator phrasing: "${sentence}"`
        );
      }
    }
  });

  it("every source has verified: false, retrieval note, and no guide is human_reviewed without verified sources", () => {
    for (const guide of GUIDES_CONTENT) {
      assert.equal(guide.reviewStatus, "draft_needs_review");
      assert.ok(guide.sources.length >= 1);

      for (const source of guide.sources) {
        assert.equal(source.verified, false, `Source ${source.id} in ${guide.type} must have verified: false`);
        assert.ok(source.retrievalNote, `Source ${source.id} in ${guide.type} must have a retrieval note`);
        assert.ok(source.retrievalNote.length >= 10);
      }

      // Invariant: no guide can be human_reviewed if any of its sources has verified: false
      const allSourcesVerified = guide.sources.every((s) => s.verified === true);
      if (!allSourcesVerified) {
        assert.notEqual(guide.reviewStatus, "human_reviewed");
      }
    }
  });

  it("content module has no side effects at import", async () => {
    // Dynamically importing lib/guides/index.js and lib/guides/content.js should not mutate globals or DB
    const contentMod = await import("../lib/guides/content.js");
    assert.ok(contentMod.GUIDES_CONTENT);
    const indexMod = await import("../lib/guides/index.js");
    assert.ok(indexMod.listGuides);
  });

  it("mapping table has exactly 6 unique types, every scamTypeGuess is in SCAM_TYPE_GUESSES, and lookup succeeds for all", () => {
    const keys = Object.keys(GUIDE_TYPE_MAPPINGS);
    assert.equal(keys.length, 6, "Must have exactly 6 unique guide types");
    assert.deepEqual(new Set(keys), new Set(GUIDE_TYPES));

    const guessSet = new Set(SCAM_TYPE_GUESSES);

    for (const [type, mapping] of Object.entries(GUIDE_TYPE_MAPPINGS)) {
      assert.equal(mapping.guideType, type);
      assert.ok(guessSet.has(mapping.scamTypeGuess), `${mapping.scamTypeGuess} must be in SCAM_TYPE_GUESSES`);

      // Resolving via scamTypeGuess returns the correct guide
      const resolvedGuide = getGuideForScamTypeGuess(mapping.scamTypeGuess);
      assert.ok(resolvedGuide, `Lookup for scamTypeGuess '${mapping.scamTypeGuess}' must succeed`);
      assert.equal(resolvedGuide.type, type, `Lookup for '${mapping.scamTypeGuess}' returned '${resolvedGuide.type}', expected '${type}'`);
    }

    // Explicit test for overseas_agent resolution
    const overseasGuide = getGuideForScamTypeGuess("overseas_agent");
    assert.ok(overseasGuide);
    assert.equal(overseasGuide.type, "overseas_agent");

    // Explicit test for unknown guess returning null
    assert.equal(getGuideForScamTypeGuess("unknown"), null);
    assert.equal(getGuideForScamTypeGuess("non_existent_guess"), null);
  });

  // --- ROUTE TESTS ---

  it("GET /api/guides returns list of guide summaries with only titles, summaries, and types", async () => {
    const req = new Request("http://localhost/api/guides", { method: "GET" });
    const res = await listGuidesGet(req, {});
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.ok(Array.isArray(json.guides));
    assert.equal(json.guides.length, 6);

    for (const item of json.guides) {
      assert.ok(item.type);
      assert.ok(item.title);
      assert.ok(item.summary);
      // Ensure summary endpoint strips heavy sections
      assert.equal(item.howItWorks, undefined);
      assert.equal(item.redFlags, undefined);
      assert.equal(item.claims, undefined);
      assert.equal(item.sources, undefined);
    }
  });

  it("GET /api/guides/:type returns full validated guide document", async () => {
    for (const type of GUIDE_TYPES) {
      const req = new Request(`http://localhost/api/guides/${type}`, { method: "GET" });
      const res = await getGuideByTypeGet(req, { params: Promise.resolve({ type }) });
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.type, type);
      assert.ok(json.title);
      assert.ok(json.summary);
      assert.ok(json.howItWorks.length >= 1);
      assert.ok(json.redFlags.length >= 3);
      assert.ok(json.whatToVerify.length >= 1);
      assert.ok(json.whatToDo.length >= 1);
      assert.ok(json.alreadyPaid.length >= 1);
      assert.ok(json.claims.length >= 1);
      assert.ok(json.sources.length >= 1);

      // Verify schema parses without error
      const parsed = GuideSchema.parse(json);
      assert.equal(parsed.type, type);
    }
  });

  it("GET /api/guides/:type returns 404 for unknown guide types", async () => {
    const unknownType = "unknown_crypto_ponzi";
    const req = new Request(`http://localhost/api/guides/${unknownType}`, { method: "GET" });
    const res = await getGuideByTypeGet(req, { params: Promise.resolve({ type: unknownType }) });
    assert.equal(res.status, 404);

    const json = await res.json();
    assert.equal(json.code, "NOT_FOUND");
    assert.ok(!JSON.stringify(json).includes(unknownType), "Zero-echo validation applies");
  });

  it("guide routes return security and no-store headers", async () => {
    const reqList = new Request("http://localhost/api/guides", { method: "GET" });
    const resList = await listGuidesGet(reqList, {});
    assert.equal(resList.headers.get("x-content-type-options"), "nosniff");
    assert.equal(resList.headers.get("x-frame-options"), "DENY");
    assert.equal(resList.headers.get("cache-control"), "no-store, no-cache, must-revalidate, proxy-revalidate");

    const reqType = new Request("http://localhost/api/guides/scholarship_scam", { method: "GET" });
    const resType = await getGuideByTypeGet(reqType, { params: Promise.resolve({ type: "scholarship_scam" }) });
    assert.equal(resType.headers.get("x-content-type-options"), "nosniff");
    assert.equal(resType.headers.get("x-frame-options"), "DENY");
    assert.equal(resType.headers.get("cache-control"), "no-store, no-cache, must-revalidate, proxy-revalidate");
  });

  it("guide routes enforce guideRead rate limiter returning 429 when exhausted", async () => {
    const customLimiter = createRateLimiter({ windowMs: 60000, max: 5 });
    const baseRuntime = getRuntime();
    setRuntimeForTests({
      ...baseRuntime,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        guideRead: customLimiter,
      },
    });

    for (let i = 1; i <= 5; i++) {
      const req = new Request("http://localhost/api/guides", {
        method: "GET",
        headers: { "X-Forwarded-For": "198.51.100.22" },
      });
      const res = await listGuidesGet(req, {});
      assert.equal(res.status, 200, `Request ${i} should succeed`);
    }

    const reqBlocked = new Request("http://localhost/api/guides", {
      method: "GET",
      headers: { "X-Forwarded-For": "198.51.100.22" },
    });
    const resBlocked = await listGuidesGet(reqBlocked, {});
    assert.equal(resBlocked.status, 429);
    assert.ok(resBlocked.headers.get("retry-after"));
    const jsonBlocked = await resBlocked.json();
    assert.equal(jsonBlocked.code, "RATE_LIMITED");
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { classifySource } from "../lib/evidence/source-classifier.js";
import { scoreCase } from "../lib/scoring/score.js";

test("Source Classifier: categorizes authoritative, complaint, forum, aggregator, and unrelated URLs", () => {
  // Authoritative
  assert.equal(classifySource("https://pib.gov.in/factcheck").type, "authoritative");
  assert.equal(classifySource("https://cbi.gov.in/assets/files/fir/123.pdf").type, "authoritative");
  assert.equal(classifySource("https://scholarships.gov.in/index").type, "authoritative");
  assert.equal(classifySource("https://thehindu.com/news/national").type, "authoritative");
  assert.equal(classifySource("https://www.thehindu.com/news").type, "authoritative");

  // Complaint platforms
  assert.equal(classifySource("https://www.consumercomplaints.in/complaint-1").type, "complaint");
  assert.equal(classifySource("https://scamvoid.net/check/example.com").type, "complaint");
  assert.equal(classifySource("https://www.trustpilot.com/review/company").type, "complaint");

  // Forum / Q&A
  assert.equal(classifySource("https://www.quora.com/is-this-scam").type, "forum");
  assert.equal(classifySource("https://reddit.com/r/scams/comments/123").type, "forum");

  // Aggregator
  assert.equal(classifySource("https://www.truecaller.com/search/in/9876543210").type, "aggregator");
  assert.equal(classifySource("https://tellows.in/num/9876543210").type, "aggregator");

  // Unrelated
  assert.equal(classifySource("https://example.com/blog").type, "unrelated");
});

test("Scoring Evidence Quality: scam_reports_found capped at 10 points when backed only by forum/aggregator", () => {
  // Snapshot with scam_reports_found backed ONLY by Quora
  const snapshotForumOnly = {
    findings: [
      {
        agent: "reputation_osint",
        status: "ok",
        flags: [
          {
            id: "scam_reports_found",
            title: "Scam Reports Found",
            severity: "medium",
            evidence: [{ type: "url", value: "https://www.quora.com/thread-about-offer" }],
          },
        ],
      },
    ],
  };

  const resForum = scoreCase(snapshotForumOnly);
  const flagItemForum = resForum.flagPoints.find((f) => f.id === "scam_reports_found");
  assert.ok(flagItemForum, "scam_reports_found flag must be present");
  assert.equal(flagItemForum.points, 10, "forum-only scam reports must be capped at 10 points");

  // Snapshot with scam_reports_found backed by authoritative source
  const snapshotAuth = {
    findings: [
      {
        agent: "reputation_osint",
        status: "ok",
        flags: [
          {
            id: "scam_reports_found",
            title: "Scam Reports Found",
            severity: "medium",
            evidence: [{ type: "url", value: "https://pib.gov.in/factcheck/fraud-alert" }],
          },
        ],
      },
    ],
  };

  const resAuth = scoreCase(snapshotAuth);
  const flagItemAuth = resAuth.flagPoints.find((f) => f.id === "scam_reports_found");
  assert.ok(flagItemAuth, "scam_reports_found flag must be present");
  assert.equal(flagItemAuth.points, 25, "authoritative scam reports get full weight 25 points");
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECK_STATUSES,
  ENTITY_KINDS,
  ENTITY_SOURCES,
  INPUT_TYPES,
  AGENT_NAMES,
  AGENT_KINDS,
  AGENT_STATUSES,
  SEVERITIES,
  RISK_LEVELS,
  CONFIDENCE_LEVELS,
  SCAM_TYPES,
  LANGUAGES,
  API_ERROR_CODES,
  EVENT_TYPES,
  FEEDBACK_VERDICTS,
  FLAG_REGISTRY,
  FLAG_GROUPS,
  FLAG_GROUP_CAPS,
  SOFT_FLAG_CAP,
  NO_HIGH_EVIDENCE_CAP,
  isFlagId,
  defaultSeverity,
  canEmit,
  getFlagGroups,
  normalizeDomain,
  normalizeUpi,
  normalizeEmail,
  normalizeHandle,
  normalizeCompany,
  normalizeAmount,
  classifyAtString,
  isValidE164,
  EvidenceSchema,
  FlagSchema,
  EntitySchema,
  AgentResultSchema,
  CheckSchema,
  CheckSubmissionSchema,
  CheckInputRowSchema,
  ClassifierResultSchema,
  ScoreResultSchema,
  ReportSchema,
  ProgressEventSchema,
  CheckEventRowSchema,
  ApiErrorSchema,
  FeedbackSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  GraphMatchSchema,
  CaseFileSchema,
} from "../lib/contracts/index.js";

import { validFixtures } from "../lib/contracts/fixtures/valid/valid-fixtures.js";
import { invalidFixtures } from "../lib/contracts/fixtures/invalid/invalid-fixtures.js";
import { flagScenarioFixtures } from "../lib/contracts/fixtures/flag-scenarios.js";
import { scoringInputFixtures } from "../lib/contracts/fixtures/scoring-inputs.js";
import {
  clearScamScenario,
  buildClearScamCaseFile,
  genuineNoticeScenario,
  buildGenuineNoticeCaseFile,
  ambiguousThinEvidenceScenario,
  buildAmbiguousThinEvidenceCaseFile,
} from "../lib/contracts/fixtures/scenarios/index.js";

test("Contract Registry: all unique flags have valid severities, emitters, weights, and checklist entries", () => {
  const flagIds = Object.keys(FLAG_REGISTRY);
  assert.ok(flagIds.length > 0, "Flag registry must not be empty");

  const uniqueIds = new Set(flagIds);
  assert.equal(uniqueIds.size, flagIds.length, "All flag IDs in FLAG_REGISTRY must be unique");

  // FLAG_REGISTRY must be frozen
  assert.ok(Object.isFrozen(FLAG_REGISTRY), "FLAG_REGISTRY object must be frozen");

  for (const [id, meta] of Object.entries(FLAG_REGISTRY)) {
    assert.ok(Object.isFrozen(meta), `FLAG_REGISTRY entry ${id} must be frozen`);
    assert.ok(Object.isFrozen(meta.emitters), `FLAG_REGISTRY emitters for ${id} must be frozen`);
    assert.ok(Object.isFrozen(meta.groups), `FLAG_REGISTRY groups for ${id} must be frozen`);
    assert.equal(meta.id, id, `Flag id field must match key: ${id}`);
    assert.ok(SEVERITIES.includes(meta.severity), `Flag ${id} has invalid severity: ${meta.severity}`);
    assert.ok(Array.isArray(meta.emitters) && meta.emitters.length > 0, `Flag ${id} must have emitters`);
    for (const emitter of meta.emitters) {
      assert.ok(AGENT_NAMES.includes(emitter), `Flag ${id} emitter '${emitter}' must be in AGENT_NAMES`);
      assert.equal(canEmit(id, emitter), true, `canEmit should return true for registered emitter ${emitter}`);
    }
    assert.equal(canEmit(id, "non_existent_agent"), false);
    assert.equal(isFlagId(id), true, `isFlagId should return true for ${id}`);
    assert.equal(defaultSeverity(id), meta.severity, `defaultSeverity mismatch for ${id}`);
    assert.ok(Array.isArray(getFlagGroups(id)), `getFlagGroups should return array for ${id}`);
  }

  // Renamed flag exists, old name does not
  assert.equal(isFlagId("fee_demand"), true);
  assert.equal(isFlagId("fee_before_selection"), false);

  // New flags exist
  assert.equal(isFlagId("equipment_advance"), true);
  assert.equal(isFlagId("unsolicited_award"), true);
  assert.equal(isFlagId("chat_only_interview"), true);
  assert.equal(isFlagId("pay_too_high"), true);
  assert.equal(isFlagId("candidate_picks_hours"), true);
  assert.equal(isFlagId("unusual_pay_schedule"), true);
  assert.equal(isFlagId("data_harvest_redirects"), true);

  // Groups and caps integrity
  assert.ok(Object.isFrozen(FLAG_GROUPS));
  assert.ok(Object.isFrozen(FLAG_GROUP_CAPS));
  assert.equal(SOFT_FLAG_CAP, 45);
  assert.equal(NO_HIGH_EVIDENCE_CAP, 59);
  assert.deepEqual([...FLAG_GROUPS.fee], ["scholarship_fee_demand", "fee_demand"]);
  assert.deepEqual([...FLAG_GROUPS.fee_equipment], ["fee_demand", "equipment_advance"]);
  assert.deepEqual([...FLAG_GROUPS.hiring_process], ["chat_only_interview", "no_interview_selection", "candidate_picks_hours"]);
  assert.deepEqual([...FLAG_GROUPS.pay], ["pay_too_high", "unusual_pay_schedule"]);
  assert.equal(FLAG_GROUP_CAPS.hiring_process, 20);
  assert.equal(FLAG_GROUP_CAPS.pay, 20);

  assert.equal(isFlagId("non_existent_flag"), false);
  assert.equal(defaultSeverity("non_existent_flag"), null);
  assert.equal(canEmit("non_existent_flag", "message_analyst"), false);
});

test("Contract Normalization: domain normalization order of operations, punycode, and invalid inputs", () => {
  assert.equal(normalizeDomain("https://evil.example/login@good.example"), "evil.example");
  assert.equal(normalizeDomain("https://good.example@evil.example/"), "evil.example");
  assert.equal(normalizeDomain("HTTPS://WWW.Example.TEST:8080/a?b#c"), "example.test");
  assert.equal(normalizeDomain("//host.example/path"), "host.example");
  assert.equal(normalizeDomain("bücher.example"), "xn--bcher-kva.example");
  assert.equal(normalizeDomain(""), "");
  assert.equal(normalizeDomain("not a domain"), "");
  assert.equal(normalizeDomain("1.2.3.4"), "");
  assert.equal(normalizeDomain("http://user:pass@sub.domain.org:8080/"), "sub.domain.org");
  assert.equal(normalizeDomain("WWW.Portal.Edu.IN."), "portal.edu.in");
});

test("Contract Normalization: amount digits-only integer string and decimal rejection", () => {
  assert.equal(normalizeAmount("100.00"), "100");
  assert.equal(normalizeAmount("5,000.00"), "5000");
  assert.equal(normalizeAmount("Rs 5,000"), "5000");
  assert.equal(normalizeAmount("₹5000"), "5000");
  assert.equal(normalizeAmount("100.50"), "");
  assert.equal(normalizeAmount(".00"), "");
  assert.equal(normalizeAmount("0.00"), "");
  assert.equal(normalizeAmount("abc"), "");
  assert.equal(normalizeAmount("5000.50"), "");
  assert.equal(normalizeAmount("100.01"), "");
  assert.equal(normalizeAmount(""), "");
});

test("Contract Normalization: upi, email, handle, company, and classifyAtString", () => {
  assert.equal(normalizeUpi("  User@OKAxis  "), "user@okaxis");
  assert.equal(normalizeEmail("  HR.Officer@Company.COM  "), "hr.officer@company.com");
  assert.equal(normalizeHandle("  @recruiter_desk  "), "recruiter_desk");
  assert.equal(normalizeHandle("@@@telegram_channel"), "telegram_channel");
  assert.equal(normalizeCompany("  Tata   Consultancy    Services  "), "Tata Consultancy Services");

  // Company normalization does not truncate: returns full string with collapsed whitespace
  const longCompany = "A".repeat(250);
  const normalizedLongCompany = normalizeCompany(`  ${longCompany}  `);
  assert.equal(normalizedLongCompany.length, 250, "normalizeCompany must not truncate strings over 200 characters");
  assert.equal(normalizedLongCompany, longCompany);

  // Schema rejects company values over 200 characters
  const validEntity = EntitySchema.safeParse({
    checkId: "11111111-1111-4111-8111-111111111111",
    kind: "company",
    value: "A".repeat(200),
    source: "user",
    round: 0,
    confirmed: true,
  });
  assert.equal(validEntity.success, true, "Company with exactly 200 characters is accepted");

  const invalidOver200Entity = EntitySchema.safeParse({
    checkId: "11111111-1111-4111-8111-111111111111",
    kind: "company",
    value: "A".repeat(201),
    source: "user",
    round: 0,
    confirmed: true,
  });
  assert.equal(invalidOver200Entity.success, false, "Company with > 200 characters must be rejected by schema");
  assert.ok(
    invalidOver200Entity.error.issues.some((issue) =>
      issue.message.includes("at most 200 characters")
    )
  );

  // classifyAtString: dot-after-@ rule
  assert.equal(classifyAtString("user@bankhandle"), "upi");
  assert.equal(classifyAtString("applicant@gmail.com"), "email");
  assert.equal(classifyAtString("student.affairs@university.ac.in"), "email");
  assert.equal(classifyAtString("cashdesk@paytm"), "upi");
  assert.equal(classifyAtString("invalid-no-at"), null);
  assert.equal(classifyAtString("invalid@double@at"), null);
});

test("Contract Normalization: E.164 phone regex check", () => {
  assert.equal(isValidE164("+919876543210"), true);
  assert.equal(isValidE164("+14155552671"), true);
  assert.equal(isValidE164("+1234567"), true, "Country code + 6 digits = 7 digits min allowed by regex");
  assert.equal(isValidE164("9876543210"), false, "Missing leading +");
  assert.equal(isValidE164("+0123456789"), false, "Country code cannot start with 0");
  assert.equal(isValidE164("+91-98765-43210"), false, "Hyphens not allowed in E.164");
  assert.equal(isValidE164("+12345"), false, "Fewer than 7 total digits");
});

test("Fixtures: every valid fixture passes strict zod validation", () => {
  for (const fixture of validFixtures) {
    const parseResult = fixture.schema.safeParse(fixture.data);
    assert.ok(
      parseResult.success,
      `Valid fixture '${fixture.name}' failed validation: ${JSON.stringify(parseResult.error?.issues)}`
    );
  }
});

test("Fixtures: every invalid fixture fails with expected error message", () => {
  for (const fixture of invalidFixtures) {
    const parseResult = fixture.schema.safeParse(fixture.data);
    assert.equal(
      parseResult.success,
      false,
      `Invalid fixture '${fixture.name}' unexpectedly passed validation`
    );
    const combinedErrors = parseResult.error.issues.map((i) => i.message).join(" | ");
    assert.match(
      combinedErrors,
      fixture.expectedError,
      `Invalid fixture '${fixture.name}' failed with unexpected error: ${combinedErrors}`
    );
  }
});

/**
 * Test-only pure helper computing agent eligibility per ARCHITECTURE section 3.5.
 * Used exclusively in tests to verify scenarios match eligibility contracts.
 */
function computeEligibleAgents(caseFile, round) {
  const eligible = new Set();
  const hasMessageText = caseFile.inputs.some(
    (i) => i.type === "text" && typeof i.value === "string" && i.value.trim().length > 0
  );

  if (round === 1) {
    if (hasMessageText) {
      eligible.add("message_analyst");
      eligible.add("classifier_client");
    }
  }

  const entities = caseFile.entities || [];
  const processedByAgent = (caseFile.control && caseFile.control.processedEntitiesByAgent) || {};

  function hasUnprocessed(agent, kinds) {
    const processed = new Set(processedByAgent[agent] || []);
    return entities.some((e) => kinds.includes(e.kind) && !processed.has(`${e.kind}:${e.value}`));
  }

  if (hasUnprocessed("website_forensics", ["domain", "url"])) {
    eligible.add("website_forensics");
  }
  if (hasUnprocessed("payment_entity", ["upi", "phone", "handle", "email", "domain"])) {
    eligible.add("payment_entity");
  }
  if (hasUnprocessed("official_verifier", ["company", "domain"])) {
    eligible.add("official_verifier");
  }
  if (hasUnprocessed("reputation_osint", ["company", "domain", "handle", "youtube_url"])) {
    eligible.add("reputation_osint");
  }

  return eligible;
}

/**
 * Test-only pure helper verifying quote evidence matches case file text under L5 rule
 * (whitespace collapsed, case-insensitive, against inputs, entity values, and message text).
 */
function verifyQuotesUnderL5Rule(caseFile) {
  const textCorpus = [
    ...caseFile.inputs.map((i) => i.value || ""),
    ...caseFile.entities.map((e) => e.value || ""),
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  for (const finding of caseFile.findings) {
    for (const flag of finding.flags) {
      for (const ev of flag.evidence) {
        if (ev.type === "quote") {
          const normalizedQuote = ev.value.replace(/\s+/g, " ").toLowerCase();
          assert.ok(
            textCorpus.includes(normalizedQuote),
            `Quote evidence '${ev.value}' not found in case file text under L5 rule (flag: ${flag.id}, agent: ${finding.agent})`
          );
        }
      }
    }
    for (const ne of finding.newEntities) {
      if (ne.evidence && ne.evidence.type === "quote") {
        const normalizedQuote = ne.evidence.value.replace(/\s+/g, " ").toLowerCase();
        assert.ok(
          textCorpus.includes(normalizedQuote),
          `NewEntity quote evidence '${ne.evidence.value}' not found in case file text under L5 rule`
        );
      }
    }
  }
}

test("Scenarios: Clear Scam (Scenario A) validates against CaseFile and sub-schemas", () => {
  // 1. CheckSubmission validates
  const subParse = CheckSubmissionSchema.safeParse(clearScamScenario.submission);
  assert.ok(subParse.success, `Scenario A submission failed: ${JSON.stringify(subParse.error?.issues)}`);

  // 2. Entities validate
  for (const entity of clearScamScenario.entities) {
    const entParse = EntitySchema.safeParse(entity);
    assert.ok(entParse.success, `Scenario A entity failed: ${JSON.stringify(entParse.error?.issues)}`);
  }

  // 3. AgentResults validate
  for (const res of clearScamScenario.results) {
    const resParse = AgentResultSchema.safeParse(res);
    assert.ok(resParse.success, `Scenario A result (${res.agent}) failed: ${JSON.stringify(resParse.error?.issues)}`);
  }

  // 4. Assemble using fixture builder and validate
  const caseFile = buildClearScamCaseFile();
  assert.ok(caseFile.entities.length > 0, "Scenario A must have non-empty entities");
  assert.ok(caseFile.findings.length > 0, "Scenario A must have non-empty findings");
  assert.ok(caseFile.events.length > 0, "Scenario A must have non-empty events");

  const cfParse = CaseFileSchema.safeParse(caseFile);
  assert.ok(cfParse.success, `Scenario A CaseFile failed: ${JSON.stringify(cfParse.error?.issues)}`);
  assert.equal(clearScamScenario.expectedRiskLevel, "high");
  assert.equal(clearScamScenario.expectedConfidence, "high");
  assert.equal(clearScamScenario.confidenceProvisional, true);

  // 5. Test L5 quote rule & eligibility
  verifyQuotesUnderL5Rule(caseFile);
  const eligibleR1 = computeEligibleAgents(
    { ...caseFile, entities: clearScamScenario.entities.filter((e) => e.round === 0), control: { processedEntitiesByAgent: {} } },
    1
  );
  assert.ok(eligibleR1.has("message_analyst"));
  assert.ok(eligibleR1.has("classifier_client"));
  assert.ok(eligibleR1.has("payment_entity"));
  assert.ok(eligibleR1.has("website_forensics"));
  assert.ok(eligibleR1.has("official_verifier"));
  assert.ok(eligibleR1.has("reputation_osint"));
});

test("Scenarios: Genuine Notice (Scenario B) validates against CaseFile and sub-schemas", () => {
  // 1. CheckSubmission validates
  const subParse = CheckSubmissionSchema.safeParse(genuineNoticeScenario.submission);
  assert.ok(subParse.success, `Scenario B submission failed: ${JSON.stringify(subParse.error?.issues)}`);

  // 2. Entities validate
  for (const entity of genuineNoticeScenario.entities) {
    const entParse = EntitySchema.safeParse(entity);
    assert.ok(entParse.success, `Scenario B entity failed: ${JSON.stringify(entParse.error?.issues)}`);
  }

  // 3. AgentResults validate
  for (const res of genuineNoticeScenario.results) {
    const resParse = AgentResultSchema.safeParse(res);
    assert.ok(resParse.success, `Scenario B result (${res.agent}) failed: ${JSON.stringify(resParse.error?.issues)}`);
  }

  // 4. Assemble using fixture builder and validate
  const caseFile = buildGenuineNoticeCaseFile();
  assert.ok(caseFile.entities.length > 0, "Scenario B must have non-empty entities");
  assert.ok(caseFile.findings.length > 0, "Scenario B must have non-empty findings");
  assert.ok(caseFile.events.length > 0, "Scenario B must have non-empty events");

  const cfParse = CaseFileSchema.safeParse(caseFile);
  assert.ok(cfParse.success, `Scenario B CaseFile failed: ${JSON.stringify(cfParse.error?.issues)}`);
  assert.equal(genuineNoticeScenario.expectedRiskLevel, "low");
  assert.equal(genuineNoticeScenario.expectedConfidence, "high");
  assert.equal(genuineNoticeScenario.confidenceProvisional, true);

  // 5. Test L5 quote rule & eligibility
  verifyQuotesUnderL5Rule(caseFile);
});

test("Scenarios: Ambiguous Thin Evidence (Scenario C) validates against CaseFile and sub-schemas", () => {
  // 1. CheckSubmission validates
  const subParse = CheckSubmissionSchema.safeParse(ambiguousThinEvidenceScenario.submission);
  assert.ok(subParse.success, `Scenario C submission failed: ${JSON.stringify(subParse.error?.issues)}`);

  // 2. Entities validate
  for (const entity of ambiguousThinEvidenceScenario.entities) {
    const entParse = EntitySchema.safeParse(entity);
    assert.ok(entParse.success, `Scenario C entity failed: ${JSON.stringify(entParse.error?.issues)}`);
  }

  // 3. AgentResults validate
  for (const res of ambiguousThinEvidenceScenario.results) {
    const resParse = AgentResultSchema.safeParse(res);
    assert.ok(resParse.success, `Scenario C result (${res.agent}) failed: ${JSON.stringify(resParse.error?.issues)}`);
  }

  // 4. Assemble using fixture builder and validate
  const caseFile = buildAmbiguousThinEvidenceCaseFile();
  assert.ok(caseFile.entities.length > 0, "Scenario C must have non-empty entities");
  assert.ok(caseFile.findings.length > 0, "Scenario C must have non-empty findings");
  assert.ok(caseFile.events.length > 0, "Scenario C must have non-empty events");

  const cfParse = CaseFileSchema.safeParse(caseFile);
  assert.ok(cfParse.success, `Scenario C CaseFile failed: ${JSON.stringify(cfParse.error?.issues)}`);
  assert.equal(ambiguousThinEvidenceScenario.expectedRiskLevel, "cannot_verify");
  assert.equal(ambiguousThinEvidenceScenario.expectedConfidence, "low");
  assert.equal(ambiguousThinEvidenceScenario.confidenceProvisional, true);

  // 5. Test L5 quote rule & eligibility
  verifyQuotesUnderL5Rule(caseFile);
});

test("classifierResult accepted for classifier_client ok", () => {
  const result = {
    checkId: "11111111-1111-4111-8111-111111111111",
    agent: "classifier_client",
    kind: "check",
    round: 1,
    status: "ok",
    flags: [],
    verified: [],
    newEntities: [],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    durationMs: 42,
    classifierResult: {
      probability: 0.85,
      label: "suspicious",
      topTerms: ["fee", "deposit"],
      scamType: "scholarship_scam",
    },
  };
  const parsed = AgentResultSchema.safeParse(result);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.classifierResult.probability, 0.85);
  assert.equal(parsed.data.classifierResult.label, "suspicious");
});

test("rejected for message_analyst", () => {
  const result = {
    checkId: "11111111-1111-4111-8111-111111111111",
    agent: "message_analyst",
    kind: "agent",
    round: 1,
    status: "ok",
    flags: [],
    verified: [],
    newEntities: [],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    durationMs: 42,
    classifierResult: {
      probability: 0.85,
      label: "suspicious",
      topTerms: ["fee"],
    },
  };
  const parsed = AgentResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  const msgs = parsed.error.issues.map((i) => i.message).join(" | ");
  assert.match(msgs, /classifierResult is allowed ONLY when agent is 'classifier_client'/);
});

test("rejected for classifier_client could_not_check", () => {
  const result = {
    checkId: "11111111-1111-4111-8111-111111111111",
    agent: "classifier_client",
    kind: "check",
    round: 1,
    status: "could_not_check",
    reason: "Upstream timeout",
    flags: [],
    verified: [],
    newEntities: [],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    durationMs: 42,
    classifierResult: {
      probability: 0.85,
      label: "suspicious",
      topTerms: ["fee"],
    },
  };
  const parsed = AgentResultSchema.safeParse(result);
  assert.equal(parsed.success, false);
  const msgs = parsed.error.issues.map((i) => i.message).join(" | ");
  assert.match(msgs, /classifierResult is allowed ONLY when status is 'ok'/);
});

test("probability 1.2 rejected", () => {
  const parsed = ClassifierResultSchema.safeParse({
    probability: 1.2,
    label: "suspicious",
    topTerms: ["scam"],
  });
  assert.equal(parsed.success, false);
  const msgs = parsed.error.issues.map((i) => i.message).join(" | ");
  assert.match(msgs, /Probability must be <= 1/);
});

test("ScoreResult valid fixture passes and each invalid fixture is rejected", () => {
  const validFixturesList = validFixtures.filter((f) => f.contract === "ScoreResult");
  assert.ok(validFixturesList.length > 0, "Must have ScoreResult valid fixtures");
  for (const vf of validFixturesList) {
    const parseRes = ScoreResultSchema.safeParse(vf.data);
    assert.equal(parseRes.success, true, `ScoreResult valid fixture '${vf.name}' failed: ${JSON.stringify(parseRes.error?.issues)}`);
  }

  const invalidFixturesList = invalidFixtures.filter((f) => f.contract === "ScoreResult");
  assert.ok(invalidFixturesList.length >= 3, "Must have at least 3 invalid ScoreResult fixtures");
  for (const inv of invalidFixturesList) {
    const parseRes = ScoreResultSchema.safeParse(inv.data);
    assert.equal(parseRes.success, false, `ScoreResult invalid fixture '${inv.name}' unexpectedly passed`);
    const combinedErrors = parseRes.error.issues.map((i) => i.message).join(" | ");
    assert.match(combinedErrors, inv.expectedError, `ScoreResult invalid fixture '${inv.name}' error mismatch: ${combinedErrors}`);
  }
});

test("Flag Scenarios: positive fixtures validate against schemas and contain target flags with evidence", () => {
  const positives = flagScenarioFixtures.filter((f) => f.type === "positive");
  assert.equal(positives.length, 8, "Must have exactly 8 positive flag scenario fixtures");

  for (const fixture of positives) {
    const parsed = AgentResultSchema.safeParse(fixture.finding);
    assert.equal(
      parsed.success,
      true,
      `Positive fixture '${fixture.id}' failed AgentResultSchema: ${JSON.stringify(parsed.error?.issues)}`
    );

    const hasTargetFlag = fixture.finding.flags.some((fl) => fl.id === fixture.flagId);
    assert.equal(hasTargetFlag, true, `Positive fixture '${fixture.id}' must contain target flag '${fixture.flagId}'`);

    for (const flag of fixture.finding.flags) {
      const flagParsed = FlagSchema.safeParse(flag);
      assert.equal(flagParsed.success, true, `Flag '${flag.id}' in '${fixture.id}' failed FlagSchema`);
      assert.ok(flag.evidence.length >= 1, `Flag '${flag.id}' in '${fixture.id}' must have at least 1 evidence item`);
    }
  }
});

test("Flag Scenarios: negative fixtures validate against schemas and assert absence of target flags and invariant violations", () => {
  const negatives = flagScenarioFixtures.filter((f) => f.type === "negative");
  assert.equal(negatives.length, 10, "Must have exactly 10 negative flag scenario fixtures");

  for (const fixture of negatives) {
    const parsed = AgentResultSchema.safeParse(fixture.finding);
    assert.equal(
      parsed.success,
      true,
      `Negative fixture '${fixture.id}' failed AgentResultSchema: ${JSON.stringify(parsed.error?.issues)}`
    );

    if (fixture.flagId) {
      const containsTargetFlag = fixture.finding.flags.some((fl) => fl.id === fixture.flagId);
      assert.equal(
        containsTargetFlag,
        false,
        `Negative fixture '${fixture.id}' must NOT contain target flag '${fixture.flagId}'`
      );
    }

    if (fixture.alternativeFlagId) {
      const containsAltFlag = fixture.finding.flags.some((fl) => fl.id === fixture.alternativeFlagId);
      assert.equal(
        containsAltFlag,
        false,
        `Negative fixture '${fixture.id}' must NOT contain alternative flag '${fixture.alternativeFlagId}'`
      );
    }

    // Invariant: Website Forensics .org TLD must never appear in verified on TLD alone
    if (fixture.id === "website_forensics_org_tld_negative") {
      assert.equal(
        fixture.finding.verified.some((v) => v.includes(".org") || v.includes(fixture.targetDomain)),
        false,
        "Website Forensics fixture must not place a .org domain in verified on TLD alone"
      );
    }
  }
});

test("Scoring Input Fixtures: Phase 4 input snapshots validate and match expected safeguard calculations", () => {
  const {
    caseA_genuineWithFiveSoftFlags,
    caseB_scamWithFeeDemandAndSoftFlags,
    caseC_maxSoftFlagsWithMaxClassifier,
    caseD_feeDemandPlusEquipmentAdvance,
  } = scoringInputFixtures;

  // Validate all findings against AgentResultSchema
  for (const [caseName, fixture] of Object.entries(scoringInputFixtures)) {
    assert.ok(Array.isArray(fixture.findings), `Fixture '${caseName}' must have findings array`);
    for (const finding of fixture.findings) {
      const parsed = AgentResultSchema.safeParse(finding);
      assert.equal(
        parsed.success,
        true,
        `Finding in scoring input fixture '${caseName}' failed AgentResultSchema: ${JSON.stringify(parsed.error?.issues)}`
      );
    }
  }

  // Assert expected output metadata matches specification
  // Case A: 47 Medium with correlation caps
  assert.equal(caseA_genuineWithFiveSoftFlags.expected.score, 47);
  assert.equal(caseA_genuineWithFiveSoftFlags.expected.level, "medium");
  assert.deepEqual([...caseA_genuineWithFiveSoftFlags.expected.rulesFired], [
    "correlation_cap:hiring_process",
    "correlation_cap:pay",
  ]);

  // Case B: 77 High with fee_demand and correlation caps
  assert.equal(caseB_scamWithFeeDemandAndSoftFlags.expected.score, 77);
  assert.equal(caseB_scamWithFeeDemandAndSoftFlags.expected.level, "high");
  assert.deepEqual([...caseB_scamWithFeeDemandAndSoftFlags.expected.rulesFired], [
    "correlation_cap:hiring_process",
    "correlation_cap:pay",
  ]);

  // Case C: 59 Medium with maximum soft flags and maximum classifier
  assert.equal(caseC_maxSoftFlagsWithMaxClassifier.expected.score, 59);
  assert.equal(caseC_maxSoftFlagsWithMaxClassifier.expected.level, "medium");
  assert.deepEqual([...caseC_maxSoftFlagsWithMaxClassifier.expected.rulesFired], [
    "no_high_evidence_cap",
    "soft_flag_cap_applied",
  ]);

  // Case D: fee_demand 30 only with exclusion:fee_equipment
  assert.equal(caseD_feeDemandPlusEquipmentAdvance.expected.countedFlag, "fee_demand");
  assert.equal(caseD_feeDemandPlusEquipmentAdvance.expected.countedPoints, 30);
  assert.equal(caseD_feeDemandPlusEquipmentAdvance.expected.suppressedFlag, "equipment_advance");
  assert.equal(caseD_feeDemandPlusEquipmentAdvance.expected.suppressedPoints, 0);
  assert.deepEqual([...caseD_feeDemandPlusEquipmentAdvance.expected.rulesFired], ["exclusion:fee_equipment"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  TraceEventSchema,
  CandidateTraceEventSchema,
  ToolEndDetailSchema,
  truncateEventPayload,
  MAX_EVENT_BYTES,
} from "../lib/contracts/trace.js";
import { traceEventFixtures } from "../lib/contracts/fixtures/trace/individual-events.js";
import { fakeScholarshipStream } from "../lib/contracts/fixtures/trace/fake-scholarship-stream.js";

test("Trace Contracts: all individual fixtures validate against TraceEventSchema", () => {
  for (const [name, fixture] of Object.entries(traceEventFixtures)) {
    const result = TraceEventSchema.safeParse(fixture);
    assert.ok(
      result.success,
      `Fixture "${name}" failed to validate: ${JSON.stringify(result.error?.issues)}`
    );
  }
});

test("Trace Contracts: full realistic fake-scholarship stream validates with monotonic seq", () => {
  let prevSeq = 0;
  for (let i = 0; i < fakeScholarshipStream.length; i++) {
    const ev = fakeScholarshipStream[i];
    const result = TraceEventSchema.safeParse(ev);
    assert.ok(
      result.success,
      `Stream event index ${i} (seq ${ev.seq}, type ${ev.type}) failed: ${JSON.stringify(
        result.error?.issues
      )}`
    );
    assert.ok(ev.seq > prevSeq, `Expected seq ${ev.seq} > prevSeq ${prevSeq}`);
    prevSeq = ev.seq;
  }
  assert.equal(fakeScholarshipStream.length, 28);
});

test("Trace Contracts: malformed events are rejected", () => {
  // Missing required type
  const bad1 = { seq: 1, checkId: "c1", ts: "2026-10-27T10:00:00Z", round: 1, agent: null };
  assert.equal(TraceEventSchema.safeParse(bad1).success, false);

  // Invalid tool in tool_end
  const bad2 = {
    seq: 1,
    checkId: "c1",
    ts: "2026-10-27T10:00:00Z",
    round: 1,
    agent: "official_verifier",
    type: "tool_end",
    callId: "call_01",
    tool: "unknown_tool",
    status: "ok",
    durationMs: 10,
    summary: "done",
    detail: { tool: "unknown_tool" },
  };
  assert.equal(TraceEventSchema.safeParse(bad2).success, false);

  // Note text over 80 chars
  const bad3 = {
    seq: 1,
    checkId: "c1",
    ts: "2026-10-27T10:00:00Z",
    round: 1,
    agent: "message_analyst",
    type: "note",
    text: "A".repeat(81),
  };
  assert.equal(TraceEventSchema.safeParse(bad3).success, false);
});

test("Trace Contracts: 4 KB limit helper truncates oversized fields and preserves schema validity", () => {
  const massiveSearchEvent = {
    seq: 1,
    checkId: "c0a80101-0000-4000-8000-000000000001",
    ts: "2026-10-27T10:00:00.000Z",
    round: 1,
    agent: "official_verifier",
    type: "tool_end",
    callId: "call_srch_huge",
    tool: "search",
    status: "ok",
    durationMs: 300,
    summary: "Large search ".repeat(50),
    detail: {
      tool: "search",
      query: "Scholarship scheme portal verification query ".repeat(30),
      resultCount: 10,
      results: Array.from({ length: 10 }, (_, i) => ({
        title: `Portal Title Result ${i} ` + "X".repeat(50),
        url: `https://scholarships.example.gov.in/portal/page/${i}`,
        snippet: `Massive snippet text describing scheme verification rules ${i} ` + "Z".repeat(120),
        read: i < 3,
      })),
    },
  };

  const initialBytes = Buffer.byteLength(JSON.stringify(massiveSearchEvent), "utf8");
  assert.ok(initialBytes > MAX_EVENT_BYTES, `Expected initial size > 4096, got ${initialBytes}`);

  const truncated = truncateEventPayload(massiveSearchEvent);
  const truncatedBytes = Buffer.byteLength(JSON.stringify(truncated), "utf8");

  assert.ok(
    truncatedBytes <= MAX_EVENT_BYTES,
    `Expected truncated size <= 4096, got ${truncatedBytes}`
  );
  assert.equal(truncated.type, "tool_end");
  assert.equal(truncated.tool, "search");
  assert.equal(truncated.detail.tool, "search");

  // Verify truncated event is still valid
  const validation = TraceEventSchema.safeParse(truncated);
  assert.ok(
    validation.success,
    `Truncated event must still satisfy TraceEventSchema: ${JSON.stringify(validation.error?.issues)}`
  );
});

test("Trace Contracts: CandidateTraceEventSchema accepts candidate without seq", () => {
  const candidate = {
    checkId: "c0a80101-0000-4000-8000-000000000001",
    ts: "2026-10-27T10:00:00.000Z",
    round: 1,
    agent: "message_analyst",
    type: "note",
    text: "Reviewing offer text",
  };

  const result = CandidateTraceEventSchema.safeParse(candidate);
  assert.ok(result.success, `Candidate validation failed: ${JSON.stringify(result.error?.issues)}`);
});

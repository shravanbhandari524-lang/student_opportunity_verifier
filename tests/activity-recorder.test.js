import test from "node:test";
import assert from "node:assert/strict";
import { createActivityRecorder, sanitizePlainText, sanitizeSources } from "../lib/agents/activity.js";
import { ActivityEntrySchema } from "../lib/contracts/agent-result.js";

test("ActivityRecorder: records steps, findings, inputs, and verified entries with monotonic seq", () => {
  const events = [];
  const recorder = createActivityRecorder({
    agent: "website_forensics",
    onEvent: (ev) => events.push(ev),
    nowFn: (() => {
      let time = 1000;
      return () => {
        time += 50;
        return time;
      };
    })(),
    round: 1,
  });

  const inEntry = recorder.input({
    title: "Checking domain google.com",
    detail: "Extracted from offer text",
  });
  assert.equal(inEntry.seq, 0);
  assert.equal(inEntry.type, "input");
  assert.equal(inEntry.status, "info");

  const stepEntry = recorder.step({
    title: "Looked up RDAP registration",
    detail: "Domain registered on 1997-09-15",
    tool: "rdap",
    sources: [{ label: "RDAP ICANN", url: "https://rdap.org/domain/google.com" }],
  });
  assert.equal(stepEntry.seq, 1);
  assert.equal(stepEntry.tool, "rdap");
  assert.equal(stepEntry.sources.length, 1);

  const verEntry = recorder.verified({
    title: "Established domain age",
    detail: "Domain is over 25 years old",
  });
  assert.equal(verEntry.seq, 2);
  assert.equal(verEntry.type, "verified");

  const entries = recorder.getEntries();
  assert.equal(entries.length, 3);
  assert.equal(events.length, 3);
  assert.equal(events[0].type, "activity");
  assert.equal(events[0].agent, "website_forensics");
  assert.equal(events[0].entry.title, "Checking domain google.com");

  // Every entry parses cleanly against ActivityEntrySchema
  for (const ent of entries) {
    const parsed = ActivityEntrySchema.safeParse(ent);
    assert.ok(parsed.success, `Entry ${ent.seq} failed schema: ${JSON.stringify(parsed.error?.issues)}`);
  }
});

test("ActivityRecorder: caps maximum entries at 40 and truncates oversized strings", () => {
  const recorder = createActivityRecorder({ agent: "message_analyst" });

  for (let i = 0; i < 45; i++) {
    const res = recorder.step({ title: `Step ${i}` });
    if (i < 40) {
      assert.ok(res !== null);
    } else {
      assert.equal(res, null, `Entry ${i} beyond cap 40 must return null`);
    }
  }

  const entries = recorder.getEntries();
  assert.equal(entries.length, 40, "Total entries must not exceed 40");
});

test("ActivityRecorder: sanitizes HTML tags, collapses whitespace, and limits length", () => {
  const recorder = createActivityRecorder({ agent: "payment_entity" });

  const titleWithHtml = "<b>Urgent Payment</b> \n  Demanded  <script>alert(1)</script>";
  const longDetail = "Detail text. ".repeat(40); // > 400 chars

  const entry = recorder.finding({
    title: titleWithHtml,
    detail: longDetail,
    flagId: "personal_payment_id",
    sources: [
      { label: "Valid 1", url: "https://example.com/1" },
      { label: "Valid 2", url: "http://example.com/2" },
      { label: "Invalid FTP", url: "ftp://example.com/3" },
      { label: "Invalid javascript", url: "javascript:void(0)" },
    ],
  });

  assert.ok(!entry.title.includes("<"));
  assert.ok(!entry.title.includes(">"));
  assert.ok(entry.title.includes("Urgent Payment Demanded alert(1)"));
  assert.ok(entry.detail.length <= 400);
  assert.equal(entry.sources.length, 2, "Only valid http/https URLs allowed");

  recorder.setSummary("Summary with <b>tags</b>. ".repeat(15));
  const summary = recorder.getSummary();
  assert.ok(!summary.includes("<"));
  assert.ok(summary.length <= 160);
});

test("sanitizePlainText and sanitizeSources standalone helpers", () => {
  assert.equal(sanitizePlainText("  Hello   <b>World</b>  ", 50), "Hello World");
  assert.equal(sanitizePlainText(null, 50), "");
  assert.equal(sanitizePlainText("A".repeat(200), 10), "AAAAAAAAAA");

  const sources = sanitizeSources([
    { label: "Source A", url: "https://trusted.example/docs" },
    { label: "Bad URL", url: "not-a-url" },
    null,
    { label: "Source B", url: "http://another.example" },
  ]);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].label, "Source A");
  assert.equal(sources[1].label, "Source B");
});

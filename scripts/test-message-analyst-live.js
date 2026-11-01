/**
 * scripts/test-message-analyst-live.js
 *
 * Live regression script for Message Analyst using the real LLM provider.
 * Gated by RUN_LIVE_LLM=1.
 *
 * Runs 11 benchmark cases, 5 iterations each, testing:
 * 1. "Congratulations, you are selected for an internship at Google." (expect no_interview_selection)
 * 2. Audit case a (Google internship + UPI fee)
 * 3. Audit case b (Genuine interview offer)
 * 4. Audit case c (Task-job video liking scam)
 * 5. Audit case d (Bank account rental / mule)
 * 6. Audit case e (Maths class question / benign)
 * 7. Audit case f (Hinglish scholarship scam)
 * 8. Notes-only case (Flipkart HR on Telegram asking Rs 300 in userNotes)
 * 9. Monthly salary Rs 30000 + registration fee Rs 999
 * 10. Crypto task scam asking for USDT
 * 11. Paid placement course ("Rs 49,000 for 100% guaranteed placement")
 */

import { run } from "../lib/agents/message-analyst.js";
import { generate } from "../lib/llm/generate.js";

const CASES = [
  {
    id: "case_1_google_selection",
    name: "Exactly Google internship selection",
    text: "Congratulations, you are selected for an internship at Google.",
    userNotes: "",
    entities: [],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return result.status === "ok" && flagIds.includes("no_interview_selection");
    },
    expectedSummary: "no_interview_selection",
  },
  {
    id: "case_2_audit_a",
    name: "Audit a: Google selection + UPI fee",
    text: "Congratulations, you are selected for an internship at Google. Pay Rs 500 to rahul.hr@oksbi",
    userNotes: "",
    entities: [
      { kind: "company", value: "Google", source: "user" },
      { kind: "upi", value: "rahul.hr@oksbi", source: "extracted" },
      { kind: "handle", value: "@google_internships", source: "extracted" },
    ],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return (
        result.status === "ok" &&
        flagIds.includes("fee_demand") &&
        flagIds.includes("no_interview_selection")
      );
    },
    expectedSummary: "fee_demand + no_interview_selection",
  },
  {
    id: "case_3_audit_b",
    name: "Audit b: Genuine-looking offer",
    text: "Dear candidate, thank you for attending the interview on 12 Oct. We are pleased to offer you the role of Software Intern. Please find the offer letter attached; joining is on 1 Nov at our Bengaluru office.",
    userNotes: "",
    entities: [{ kind: "company", value: "Bengaluru Office", source: "extracted" }],
    evaluate: (result) => {
      return result.status === "ok" && result.flags.length === 0;
    },
    expectedSummary: "0 flags (benign)",
  },
  {
    id: "case_4_audit_c",
    name: "Audit c: Task-job scam",
    text: "Earn Rs 5000 daily by liking YouTube videos. Join our Telegram group. First 3 tasks are free, premium task needs a Rs 2000 deposit.",
    userNotes: "",
    entities: [],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return (
        result.status === "ok" &&
        (flagIds.includes("task_deposit_script") || flagIds.includes("fee_demand")) &&
        (flagIds.includes("pay_too_high") || flagIds.includes("guaranteed_income") || flagIds.includes("off_platform_contact"))
      );
    },
    expectedSummary: "task_deposit_script / fee_demand + pay_too_high / off_platform",
  },
  {
    id: "case_5_audit_d",
    name: "Audit d: Mule account request",
    text: "Rent your bank account for Rs 10000 a month, no work required.",
    userNotes: "",
    entities: [],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return result.status === "ok" && flagIds.includes("mule_account_request");
    },
    expectedSummary: "mule_account_request",
  },
  {
    id: "case_6_audit_e",
    name: "Audit e: Benign maths question",
    text: "What time is the maths class tomorrow?",
    userNotes: "",
    entities: [],
    evaluate: (result) => {
      return result.status === "ok" && result.flags.length === 0;
    },
    expectedSummary: "0 flags (benign)",
  },
  {
    id: "case_7_audit_f",
    name: "Audit f: Hinglish scholarship scam",
    text: "Aapko scholarship mili hai, Rs 499 processing fee bhejo 9123456789@ybl pe aaj hi warna cancel ho jayega",
    userNotes: "",
    entities: [{ kind: "upi", value: "9123456789@ybl", source: "extracted" }],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return (
        result.status === "ok" &&
        (flagIds.includes("fee_demand") || flagIds.includes("scholarship_fee_demand")) &&
        (flagIds.includes("unsolicited_award") || flagIds.includes("urgency_pressure"))
      );
    },
    expectedSummary: "fee_demand / scholarship_fee_demand + unsolicited_award / urgency",
  },
  {
    id: "case_8_notes_only",
    name: "Notes-only: Flipkart HR on Telegram",
    text: "",
    userNotes: "A guy called Ravi from Flipkart HR messaged me on Telegram, asked for 300 rupees",
    entities: [],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return (
        result.status === "ok" &&
        flagIds.includes("fee_demand") &&
        flagIds.includes("off_platform_contact")
      );
    },
    expectedSummary: "off_platform_contact + fee_demand (from notes)",
  },
  {
    id: "case_9_monthly_salary_fee",
    name: "Monthly salary Rs 30000 + registration fee Rs 999",
    text: "Monthly salary Rs 30000 direct NEFT transfer. A registration fee Rs 999 is required before your joining kit is shipped.",
    userNotes: "",
    entities: [],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return result.status === "ok" && flagIds.includes("fee_demand");
    },
    expectedSummary: "fee_demand (carve-out correctly bypassed)",
  },
  {
    id: "case_10_crypto_usdt",
    name: "Crypto task scam asking for USDT",
    text: "Earn Rs 8000 daily. To unlock premium level VIP orders, send 100 USDT deposit to our TRC20 crypto address.",
    userNotes: "",
    entities: [],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return (
        result.status === "ok" &&
        flagIds.includes("crypto_payment_request")
      );
    },
    expectedSummary: "crypto_payment_request",
  },
  {
    id: "case_11_placement_guarantee",
    name: "Paid placement course guarantee",
    text: "Enroll in our Full Stack Python internship program. Pay Rs 49,000 for 100% guaranteed placement in top MNCs or full refund.",
    userNotes: "",
    entities: [],
    evaluate: (result) => {
      const flagIds = result.flags.map((f) => f.id);
      return (
        result.status === "ok" &&
        (flagIds.includes("paid_placement_guarantee") || flagIds.includes("fee_demand"))
      );
    },
    expectedSummary: "paid_placement_guarantee",
  },
];

async function main() {
  if (process.env.RUN_LIVE_LLM !== "1") {
    console.log("RUN_LIVE_LLM is not set to 1. Skipping live LLM regression.");
    console.log("Run with: RUN_LIVE_LLM=1 node --env-file=.env.local scripts/test-message-analyst-live.js");
    process.exit(0);
  }

  console.log("================================================================================");
  console.log("Starting Live LLM Regression Test for Message Analyst (5 runs per case)");
  console.log("Provider:", process.env.LLM_PROVIDER || "gemini");
  console.log("Model:", process.env.LLM_MODEL || "gemini-3.5-flash-lite");
  console.log("Temperature: 0 (deterministic)");
  console.log("================================================================================\n");

  const ITERATIONS = 5;
  const summaryReport = [];

  for (const c of CASES) {
    console.log(`Testing [${c.id}] ${c.name}...`);
    console.log(`  Expected: ${c.expectedSummary}`);

    const runResults = [];
    let passCount = 0;

    for (let i = 1; i <= ITERATIONS; i++) {
      const snapshot = {
        check: { id: "00000000-0000-0000-0000-000000000001", currentRound: 1 },
        inputs: [],
        entities: c.entities || [],
        findings: [],
      };
      if (c.text) {
        snapshot.inputs.push({ type: "text", value: c.text });
      }
      if (c.userNotes) {
        snapshot.inputs.push({ type: "user_notes", value: c.userNotes });
      }

      const t0 = Date.now();
      let res;
      try {
        res = await run(snapshot, { generate });
      } catch (err) {
        res = { status: "could_not_check", reason: err.message, flags: [] };
      }
      const durationMs = Date.now() - t0;

      const passed = c.evaluate(res);
      if (passed) passCount++;

      const flagsStr = (res.flags || [])
        .map((f) => `${f.id}("${f.evidence?.[0]?.value || ''}")`)
        .join(", ");

      runResults.push({
        iteration: i,
        status: res.status,
        flags: res.flags || [],
        flagsStr,
        passed,
        durationMs,
      });

      console.log(`    Run ${i}: status=${res.status}, flags=[${flagsStr}], duration=${durationMs}ms -> ${passed ? "PASS" : "FAIL"}`);

      // Small cooldown between requests to respect rate limits
      await new Promise((r) => setTimeout(r, 600));
    }

    const passRate = (passCount / ITERATIONS) * 100;
    const isFlaky = passCount > 0 && passCount < ITERATIONS;

    summaryReport.push({
      id: c.id,
      name: c.name,
      passCount,
      total: ITERATIONS,
      passRate: `${passRate.toFixed(0)}%`,
      isFlaky,
      runs: runResults,
    });

    console.log(`  => Pass Rate: ${passCount}/${ITERATIONS} (${passRate.toFixed(0)}%) ${isFlaky ? "[FLAKY]" : ""}\n`);
  }

  console.log("================================================================================");
  console.log("LIVE REGRESSION SUMMARY");
  console.log("================================================================================");
  console.table(
    summaryReport.map((s) => ({
      Case: s.id,
      Name: s.name.slice(0, 40),
      PassRate: s.passRate,
      Flaky: s.isFlaky ? "YES" : "NO",
      SampleFlags: s.runs[0]?.flagsStr?.slice(0, 45) || "none",
    }))
  );

  const totalPassed = summaryReport.filter((s) => s.passCount === ITERATIONS).length;
  console.log(`\nOverall: ${totalPassed}/${CASES.length} cases achieved 100% pass rate.`);
}

main().catch((err) => {
  console.error("Fatal error during live regression:", err);
  process.exit(1);
});

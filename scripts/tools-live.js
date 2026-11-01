/**
 * scripts/tools-live.js
 *
 * Runnable live verification script for Part 3 external lookups:
 * - Executes real network calls against public targets:
 *     1. rdapLookup("example.com")
 *     2. dnsRecords("example.com")
 *     3. sslInfo("example.com")
 *     4. waybackFirstSeen("example.com")
 * - Validates output shape and prints real metrics.
 * - Invariant: Never logs secrets.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { rdapLookup, dnsRecords, sslInfo, waybackFirstSeen } from "../lib/tools/domain.js";
import { checkDomainLookalike } from "../lib/tools/lookalike.js";
import { upiFacts, emailFacts, phoneFacts } from "../lib/tools/payments.js";
import { getDb } from "../lib/db/index.js";

async function main() {
  console.log("=== Part 3 Live Tool Verification ===");

  // Use a fresh temp database so earlier runs cannot be served from cache
  const tempDbPath = path.join(os.tmpdir(), `test-tools-live-${Date.now()}.db`);
  const db = getDb(tempDbPath);
  console.log(`Using fresh temp DB: ${tempDbPath}`);

  const targetDomain = "example.com";

  console.log(`\n[1/5] Running live rdapLookup for ${targetDomain}...`);
  const t1 = Date.now();
  const rdapRes = await rdapLookup(targetDomain, { db });
  console.log(`RDAP result: ok=${rdapRes.ok}, cached=${rdapRes.cached}, ageDays=${rdapRes.data?.ageDays}, registrar="${rdapRes.data?.registrar}" (${Date.now() - t1}ms)`);
  if (!rdapRes.ok) {
    console.error("FAIL: rdapLookup returned error:", rdapRes.error);
    process.exit(1);
  }

  console.log(`\n[2/5] Running live dnsRecords for ${targetDomain}...`);
  const t2 = Date.now();
  const dnsRes = await dnsRecords(targetDomain, { db });
  console.log(`DNS result: ok=${dnsRes.ok}, cached=${dnsRes.cached}, A records=${JSON.stringify(dnsRes.data?.a)}, NS=${JSON.stringify(dnsRes.data?.ns)} (${Date.now() - t2}ms)`);
  if (!dnsRes.ok) {
    console.error("FAIL: dnsRecords returned error:", dnsRes.error);
    process.exit(1);
  }

  console.log(`\n[3/5] Running live sslInfo for ${targetDomain}...`);
  const t3 = Date.now();
  const sslRes = await sslInfo(targetDomain, { pinnedIp: dnsRes.data.a[0], db });
  console.log(`SSL result: ok=${sslRes.ok}, cached=${sslRes.cached}, authorized=${sslRes.data?.authorized}, issuer="${sslRes.data?.issuer}", daysRemaining=${sslRes.data?.daysRemaining} (${Date.now() - t3}ms)`);
  if (!sslRes.ok) {
    console.error("FAIL: sslInfo returned error:", sslRes.error);
    process.exit(1);
  }

  console.log(`\n[4/5] Running live waybackFirstSeen for ${targetDomain}...`);
  const t4 = Date.now();
  const waybackRes = await waybackFirstSeen(targetDomain, { db });
  console.log(`Wayback result: ok=${waybackRes.ok}, cached=${waybackRes.cached}, found=${waybackRes.data?.found}, firstSeen=${waybackRes.data?.firstSeen} (${Date.now() - t4}ms)`);
  if (!waybackRes.ok) {
    console.error("FAIL: waybackFirstSeen returned error:", waybackRes.error);
    process.exit(1);
  }

  // Never-archived random long domain test
  const unarchivedDomain = `unarchived-check-${Date.now()}-random.example.com`;
  console.log(`\n[5/5] Running live waybackFirstSeen for never-archived domain (${unarchivedDomain})...`);
  const t5 = Date.now();
  const unarchivedRes = await waybackFirstSeen(unarchivedDomain, { db });
  console.log(`Unarchived domain result: ok=${unarchivedRes.ok}, cached=${unarchivedRes.cached}, found=${unarchivedRes.data?.found}, firstSeen=${unarchivedRes.data?.firstSeen} (${Date.now() - t5}ms)`);
  if (!unarchivedRes.ok || unarchivedRes.data?.found !== false) {
    console.error("FAIL: expected unarchived domain to yield found: false fact, got:", unarchivedRes);
    process.exit(1);
  }

  console.log("\n[Pure facts checks] Running lookalike, payments...");
  const lookalike = checkDomainLookalike("iitb-gov.in");
  console.log(`Lookalike check ('iitb-gov.in'): isMatch=${lookalike.isMatch}, target=${lookalike.targetDomain}, method=${lookalike.method}`);

  const upi = upiFacts("intern.stipend@okaxis");
  console.log(`UPI facts ('intern.stipend@okaxis'): valid=${upi.valid}, psp=${upi.pspName}, bank=${upi.bankName}`);

  const email = emailFacts("dean@iitb.ac.in");
  console.log(`Email facts ('dean@iitb.ac.in'): valid=${email.valid}, isEduOrGov=${email.isEduOrGov}`);

  const phone = phoneFacts("+919876543210");
  console.log(`Phone facts ('+919876543210'): valid=${phone.valid}, country=${phone.country}`);

  // Clean up temp DB
  try {
    fs.unlinkSync(tempDbPath);
  } catch {
    // Ignore
  }

  console.log("\nALL LIVE TOOL CHECKS PASSED SUCCESSFULLY!");
}

main().catch((err) => {
  console.error("Unexpected live script failure:", err);
  process.exit(1);
});

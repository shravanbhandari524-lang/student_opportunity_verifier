import crypto from "node:crypto";
import { z } from "zod";
import { createCheck, getCheck } from "../lib/db/index.js";
import { generate } from "../lib/llm/generate.js";
import { getEnv } from "../lib/env.js";

async function runSmoke() {
  console.log("=== Opportunity Verifier Smoke Test ===");

  // 1. Create a check
  const testId = crypto.randomUUID();
  console.log(`1. Testing createCheck (id: ${testId})...`);
  try {
    const created = createCheck({ id: testId, language: "en", status: "created" });
    if (created && created.id === testId && created.status === "created") {
      console.log("   [PASS] Check created successfully");
    } else {
      console.error("   [FAIL] Check creation returned unexpected shape:", created);
      process.exit(1);
    }
  } catch (err) {
    console.error("   [FAIL] createCheck threw:", err.message);
    process.exit(1);
  }

  // 2. Fetch the check
  console.log(`2. Testing getCheck (id: ${testId})...`);
  try {
    const fetched = getCheck(testId);
    if (fetched && fetched.id === testId) {
      console.log("   [PASS] Check fetched successfully from DB");
      console.log(`          Expires at: ${fetched.expiresAt}`);
    } else {
      console.error("   [FAIL] Could not find created check:", fetched);
      process.exit(1);
    }
  } catch (err) {
    console.error("   [FAIL] getCheck threw:", err.message);
    process.exit(1);
  }

  // 3. Test LLM call if LLM key is configured
  console.log("3. Testing LLM generate() if key is present...");
  let envConfig;
  try {
    envConfig = getEnv(process.env);
  } catch {
    // env not fully set, check if LLM_API_KEY is present
    if (process.env.LLM_API_KEY) {
      envConfig = {
        LLM_PROVIDER: process.env.LLM_PROVIDER || "gemini",
        LLM_API_KEY: process.env.LLM_API_KEY,
        LLM_MODEL: process.env.LLM_MODEL || "gemini-2.5-flash",
      };
    }
  }

  if (envConfig && envConfig.LLM_API_KEY && !envConfig.LLM_API_KEY.includes("your_")) {
    try {
      console.log(`   Calling generate() with provider: ${envConfig.LLM_PROVIDER}, model: ${envConfig.LLM_MODEL}...`);
      const testSchema = z.object({
        status: z.literal("ok"),
        sample_scam_warning: z.string(),
      });

      const response = await generate({
        prompt: "Provide a JSON object with status 'ok' and a 1-sentence sample warning for student scholarship scams.",
        schema: testSchema,
        timeoutMs: 15000,
        customEnv: envConfig,
      });

      console.log("   [PASS] LLM generate() succeeded with valid schema response:");
      console.log("         ", JSON.stringify(response));
    } catch (err) {
      console.error("   [FAIL] LLM generate() threw error:", err.message);
      process.exit(1);
    }
  } else {
    console.log("   [SKIP] LLM_API_KEY not configured or set to placeholder. Skipping live LLM call.");
  }

  console.log("\n=== Smoke test completed successfully ===");
}

runSmoke().catch((err) => {
  console.error("Fatal error during smoke test:", err);
  process.exit(1);
});

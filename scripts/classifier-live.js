/**
 * scripts/classifier-live.js
 *
 * Checks if the local classifier microservice is running (at CLASSIFIER_URL or localhost:8000).
 * If running, sends one test classification and prints results safely.
 * If not running, prints a helpful status message with instructions to launch it.
 */

import fs from "node:fs";
import { classifyText, classifierHealth } from "../lib/classifier.js";

// Load .env.local if present
if (fs.existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore
  }
}

async function run() {
  console.log("=== Classifier Service Live Check ===");
  const healthRes = await classifierHealth();

  if (!healthRes.ok) {
    console.log(`Classifier status: Offline (${healthRes.error.code} - ${healthRes.error.message})`);
    console.log("To start the classifier microservice locally, run:");
    console.log("  ./services/classifier/.venv/bin/uvicorn services.classifier.app:app --port 8000");
    return;
  }

  console.log("Classifier status: Online");
  console.log("Health details:", healthRes.data);

  const sampleText = "Congratulations! You have been selected for the National Merit Scholarship. Please pay registration fee of Rs 1500 to activate.";
  console.log("\nSending test classification...");
  const classifyRes = await classifyText(sampleText);

  if (classifyRes.ok) {
    console.log("Classification result:");
    console.log(`  Probability: ${classifyRes.data.probability}`);
    console.log(`  Label: ${classifyRes.data.label}`);
    console.log(`  Top terms: ${classifyRes.data.topTerms.join(", ")}`);
    console.log(`  Scam type: ${classifyRes.data.scamType}`);
  } else {
    console.log("Classification error:", classifyRes.error);
  }
}

run();

/**
 * tests/ocr-reader.test.js
 *
 * Tests for local OCR reader, multi-size font fixtures, low-contrast small print,
 * and dual-reader transcript merging.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { runLocalOcr, normalizeLineForDedupe } from "../lib/tools/ocr.js";
import { mergeOcrTranscripts, runExtraction } from "../lib/extract.js";
import { getDb, createCheck, saveInputs, getInputs, replaceEntities } from "../lib/db/index.js";

const TEST_DB = "./data/test_ocr_reader.db";

function resetDb() {
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  return getDb(TEST_DB);
}

test("OCR: normalizeLineForDedupe collapses whitespace and strips special chars", () => {
  assert.equal(
    normalizeLineForDedupe("  Terms & Conditions: Fee of Rs. 850/-  "),
    "terms conditions fee of rs 850"
  );
  assert.equal(normalizeLineForDedupe(""), "");
});

test("OCR: mergeOcrTranscripts dedupes lines and marks reader origin", () => {
  const visionText = [
    "GLOBAL TECH INNOVATIONS - OFFER LETTER",
    "Selected for Internship 2026",
    "Monthly stipend Rs 25000",
  ].join("\n");

  const localOcrLines = [
    "Selected for Internship 2026",
    "Terms and Conditions: Refundable fee of Rs 850",
  ];

  const merged = mergeOcrTranscripts(visionText, localOcrLines);
  assert.equal(merged.lines.length, 4);

  const header = merged.lines.find((l) => l.line.includes("OFFER LETTER"));
  assert.ok(header);
  assert.equal(header.reader, "vision");

  const overlap = merged.lines.find((l) => l.line.includes("Internship 2026"));
  assert.ok(overlap);
  assert.equal(overlap.reader, "both");

  const fee = merged.lines.find((l) => l.line.includes("Rs 850"));
  assert.ok(fee);
  assert.equal(fee.reader, "local_ocr");

  assert.ok(merged.combinedText.includes("Rs 850"));
  assert.ok(merged.combinedText.includes("OFFER LETTER"));
});

test("OCR: captures text across font sizes and low-contrast grey small print", async () => {
  const fontSizes = [24, 16, 12, 10, 8];
  const capturedSizes = [];

  for (const size of fontSizes) {
    const textMarker = `ImportantNoticeSize${size}pt`;
    const svg = `
      <svg width="600" height="150" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#ffffff"/>
        <text x="30" y="80" font-family="sans-serif" font-size="${size}" fill="#000000">${textMarker}</text>
      </svg>
    `;
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    const res = await runLocalOcr(buf, { timeoutMs: 10000 });
    assert.equal(res.ok, true);

    const normTarget = normalizeLineForDedupe(textMarker);
    const found = res.lines.some((l) => normalizeLineForDedupe(l).includes(normTarget));
    if (found) {
      capturedSizes.push(size);
    }
  }

  // Report captured sizes
  console.log(`[OCR Size Benchmark] Font sizes tested: ${fontSizes.join(", ")} pt; Successfully captured: ${capturedSizes.join(", ")} pt`);
  assert.ok(capturedSizes.includes(24), "Should capture 24pt");
  assert.ok(capturedSizes.includes(16), "Should capture 16pt");
  assert.ok(capturedSizes.includes(12), "Should capture 12pt");

  // Low-contrast grey small-print version (9pt #888888 on #ffffff in bottom third)
  const lowContrastSvg = `
    <svg width="600" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="30" y="50" font-family="sans-serif" font-size="20" fill="#111111">Company Offer Header</text>
      <text x="30" y="100" font-family="sans-serif" font-size="14" fill="#222222">You have been selected for this position.</text>
      <!-- Bottom third fine print in low-contrast grey -->
      <text x="30" y="270" font-family="sans-serif" font-size="9" fill="#888888">Terms and Conditions: A refundable document verification fee of Rs 850 is required</text>
    </svg>
  `;
  const lowContrastBuf = await sharp(Buffer.from(lowContrastSvg)).png().toBuffer();
  const lowContrastRes = await runLocalOcr(lowContrastBuf, { timeoutMs: 10000 });
  assert.equal(lowContrastRes.ok, true);

  const foundFee = lowContrastRes.lines.some((l) =>
    l.toLowerCase().includes("refundable") || l.toLowerCase().includes("850")
  );
  console.log("[OCR Low-Contrast Benchmark] Low-contrast 9pt grey fine print captured:", foundFee);
  assert.ok(foundFee, "Upscaled bottom third OCR should capture low-contrast fine print fee");
});

test("OCR: runExtraction integrates dual readers and extracts fee from fine print", async () => {
  const db = resetDb();
  const check = createCheck({ language: "en", status: "created" }, db);

  const sampleSvg = `
    <svg width="600" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="30" y="50" font-family="sans-serif" font-size="20" fill="#111111">Global Tech Innovations Internship</text>
      <text x="30" y="260" font-family="sans-serif" font-size="10" fill="#333333">A refundable document verification fee of Rs 850 is required</text>
    </svg>
  `;
  const imgPath = path.resolve("./data/test_small_print_fixture.png");
  await sharp(Buffer.from(sampleSvg)).png().toFile(imgPath);

  const stat = fs.statSync(imgPath);
  saveInputs(
    check.id,
    [
      {
        type: "image",
        value: "test_small_print_fixture.png",
        filePath: imgPath,
        mimeType: "image/png",
        sizeBytes: stat.size,
      },
    ],
    db
  );

  // Mock vision misses small print (only returns header), local OCR captures fine print
  const mockDeps = {
    db,
    generate: async () => ({
      ok: true,
      data: {
        transcribedText: "Global Tech Innovations Internship",
        urls: [],
        amounts: [],
        paymentIds: [],
        organisationNames: ["Global Tech Innovations"],
      },
    }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };

  const extRes = await runExtraction(check.id, mockDeps);
  assert.equal(extRes.status, "awaiting_confirmation");

  // Verify that check inputs text contains the fee from local OCR
  const inputs = getInputs(check.id, db);
  const textInput = inputs.find((i) => i.type === "text");
  assert.ok(textInput);
  assert.ok(textInput.value.includes("Global Tech Innovations"));
  assert.ok(textInput.value.includes("850") || textInput.value.includes("refundable"));

  // Verify clean deletion of uploaded fixture
  assert.equal(fs.existsSync(imgPath), false, "Uploaded image should be deleted after extraction");

  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

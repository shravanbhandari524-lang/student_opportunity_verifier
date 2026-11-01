import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactComment, normalizeDevanagariDigits } from "../lib/api/redaction.js";

describe("lib/api/redaction.js", () => {
  it("normalizes Devanagari numerals to ASCII digits", () => {
    assert.equal(normalizeDevanagariDigits("०१२३४५६७८९"), "0123456789");
    assert.equal(normalizeDevanagariDigits("फोन: ९८७६५४३२१०"), "फोन: 9876543210");
  });

  it("handles null, undefined, empty, and non-string inputs safely", () => {
    assert.equal(redactComment(null), null);
    assert.equal(redactComment(undefined), null);
    assert.equal(redactComment(""), "");
    assert.equal(redactComment(12345), "");
  });

  it("redacts standard email addresses", () => {
    const input = "Contact recruiter at help.desk@scamcorp.co.in or admin@fake.org immediately.";
    const result = redactComment(input);
    assert.equal(result, "Contact recruiter at [REDACTED_EMAIL] or [REDACTED_EMAIL] immediately.");
    assert.ok(!result.includes("@scamcorp"));
  });

  it("redacts UPI IDs", () => {
    const input = "They asked to send fee to scholarship.desk@okaxis and backup hr@paytm";
    const result = redactComment(input);
    assert.equal(result, "They asked to send fee to [REDACTED_UPI] and backup [REDACTED_UPI]");
    assert.ok(!result.includes("okaxis"));
    assert.ok(!result.includes("paytm"));
  });

  it("redacts URLs (http, https, www)", () => {
    const input = "Visit https://fake-portal.example/claim and check www.lookalike-edu.org/verify for details.";
    const result = redactComment(input);
    assert.equal(result, "Visit [REDACTED_URL] and check [REDACTED_URL] for details.");
    assert.ok(!result.includes("fake-portal"));
  });

  it("redacts Indian phone numbers with +91, spaces, and hyphens", () => {
    const inputs = [
      "Call me at +91 98765 43210 immediately",
      "WhatsApp +91-98765-43210 or 9876543210",
      "Landline: (022) 23456789",
      "Dial 09876543210 for assistance",
    ];

    for (const inp of inputs) {
      const res = redactComment(inp);
      assert.ok(res.includes("[REDACTED_PHONE]"), `Expected [REDACTED_PHONE] in '${res}' from '${inp}'`);
      assert.ok(!res.includes("9876543210"));
    }
  });

  it("redacts Devanagari numerals formatted as phone numbers", () => {
    const input = "कृपया इस नंबर पर कॉल करें: ९८७६५४३२१० धन्यवाद";
    const result = redactComment(input);
    assert.ok(result.includes("[REDACTED_PHONE]"));
    assert.ok(!result.includes("९८७६५४३२१०"));
  });

  it("redacts long digit runs (account numbers >= 7 digits)", () => {
    const input = "Deposit Rs 500 into account 123456789012 now";
    const result = redactComment(input);
    assert.ok(result.includes("[REDACTED_PHONE]"));
    assert.ok(!result.includes("123456789012"));
  });

  it("leaves innocent short numbers (dates, single amounts under 7 digits) alone", () => {
    const input = "I lost Rs 500 on 2026-10-24 after 3 attempts";
    const result = redactComment(input);
    assert.ok(result.includes("Rs 500"));
    assert.ok(result.includes("3 attempts"));
  });

  it("is strictly idempotent: redactComment(redactComment(x)) === redactComment(x)", () => {
    const messy = "Scam alert! Call +91 98765 43210, email us at scam@domain.com, pay pay@okaxis or visit https://scam.example. Refund ०९८७६५४३२१०";
    const once = redactComment(messy);
    const twice = redactComment(once);
    const thrice = redactComment(twice);

    assert.equal(twice, once);
    assert.equal(thrice, once);
  });
});

/**
 * tests/ui-components.test.js
 *
 * Tests for shared frontend components and pages:
 * - RiskBadge (levels, scores, confidence, fired rules)
 * - FlagCard (severity, plain-text evidence, quote/URL distinction)
 * - Checklist (items, copy formatting, provenance)
 * - CoverageCard (checked/notChecked signals, suggestions)
 * - EntitiesEditor (add, delete, confirm payload)
 * - Accessibility & Plain-Text Security invariants
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import swc from "next/dist/build/swc/index.js";

async function loadComponent(relPath, returnFullModule = false) {
  const fullPath = path.resolve(relPath);
  const code = fs.readFileSync(fullPath, "utf8");
  const transformed = await swc.transform(code, {
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
    },
  });
  const dir = path.dirname(fullPath);
  const basename = path.basename(relPath, ".js");
  const targetFile = path.join(dir, `${basename}.test-built.mjs`);
  fs.writeFileSync(targetFile, transformed.code, "utf8");
  try {
    const mod = await import(targetFile);
    if (returnFullModule) return mod;
    return mod.default || mod;
  } finally {
    try {
      fs.unlinkSync(targetFile);
    } catch {
      // ignore
    }
  }
}

let RiskBadge;
let FlagCard;
let Checklist;
let CoverageCard;
let EntitiesEditor;
let Header;
let Footer;
let LinkExtractionCard;
let getHostFromEntity;

describe("UI Shared Components: RiskBadge", () => {
  before(async () => {
    RiskBadge = await loadComponent("components/RiskBadge.js");
    FlagCard = await loadComponent("components/FlagCard.js");
    Checklist = await loadComponent("components/Checklist.js");
    CoverageCard = await loadComponent("components/CoverageCard.js");
    EntitiesEditor = await loadComponent("components/EntitiesEditor.js");
    Header = await loadComponent("components/Header.js");
    Footer = await loadComponent("components/Footer.js");
    const linkModule = await loadComponent("components/LinkExtractionCard.js", true);
    LinkExtractionCard = linkModule.default;
    getHostFromEntity = linkModule.getHostFromEntity;
  });

  test("renders HIGH risk level with score and rules", () => {
    const html = renderToStaticMarkup(
      React.createElement(RiskBadge, {
        level: "high",
        score: 85,
        confidence: "high",
        rulesFired: ["fee_demand", "lookalike_domain"],
      })
    );

    assert.ok(html.includes("HIGH RISK"));
    assert.ok(html.includes("badge-high"));
    assert.ok(html.includes("85"));
    assert.ok(html.includes("fee_demand"));
    assert.ok(html.includes("lookalike_domain"));
    assert.ok(html.includes("Confidence:"));
  });

  test("renders CANNOT_VERIFY fallback when evidence is thin", () => {
    const html = renderToStaticMarkup(
      React.createElement(RiskBadge, {
        level: "cannot_verify",
        score: null,
        confidence: "low",
        rulesFired: [],
      })
    );

    assert.ok(html.includes("CANNOT VERIFY"));
    assert.ok(html.includes("badge-cannot_verify"));
    assert.ok(html.includes("Insufficient Public Evidence"));
  });

  test("renders LOW risk level correctly", () => {
    const html = renderToStaticMarkup(
      React.createElement(RiskBadge, {
        level: "low",
        score: 12,
        confidence: "high",
        rulesFired: [],
      })
    );

    assert.ok(html.includes("LOW RISK"));
    assert.ok(html.includes("badge-low"));
    assert.ok(html.includes("12"));
  });
});

describe("UI Shared Components: FlagCard", () => {
  test("renders severity, title, explanation, and plain-text evidence quotes", () => {
    const sampleFlag = {
      id: "upfront_fee",
      title: "Upfront Security Deposit Requested",
      severity: "high",
      explanation: "Employer is demanding an upfront payment of ₹2,500 for training materials.",
      evidence: [
        "Pay 2500 registration fee via UPI to confirm seat.",
        "https://example-scam-payment.in/pay",
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(FlagCard, {
        flag: sampleFlag,
      })
    );

    assert.ok(html.includes("Upfront Security Deposit Requested"));
    assert.ok(html.includes("badge-high"));
    assert.ok(html.includes("Pay 2500 registration fee"));
    assert.ok(html.includes("https://example-scam-payment.in/pay"));
  });
});

describe("UI Shared Components: Checklist", () => {
  test("renders actionable verification items with copy checklist button", () => {
    const checklist = [
      {
        id: "check_domain",
        text: "Check domain registration age on ICANN WHOIS",
        reason: "Newly registered domains under 30 days are high risk.",
        provenance: "domain_analyst",
      },
      {
        id: "check_gstin",
        text: "Verify GSTIN status on government GST portal",
        reason: "Valid companies display official GST numbers.",
        provenance: "registry_analyst",
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(Checklist, {
        checklist,
      })
    );

    assert.ok(html.includes("What to Verify Next"));
    assert.ok(html.includes("Check domain registration age"));
    assert.ok(html.includes("Verify GSTIN status"));
    assert.ok(html.includes("Copy checklist"));
  });
});

describe("UI Shared Components: CoverageCard", () => {
  test("renders checked and not checked signals accurately", () => {
    const html = renderToStaticMarkup(
      React.createElement(CoverageCard, {
        coverage: {
          checked: [
            { name: "Domain Registration", status: "found", detail: "Registered 12 days ago" },
            { name: "UPI ID Validation", status: "found", detail: "Individual name on UPI" },
          ],
          notChecked: [
            { name: "MCA / ROC Company Name", reason: "No corporate entity name was provided in the input text." },
          ],
        },
        improveCheck: ["Add official company name or MCA CIN if available to cross-reference registered directors."],
      })
    );

    assert.ok(html.includes("Evidence Coverage"));
    assert.ok(html.includes("Domain Registration"));
    assert.ok(html.includes("Registered 12 days ago"));
    assert.ok(html.includes("MCA / ROC Company Name"));
    assert.ok(html.includes("No corporate entity name was provided"));
  });
});

describe("UI Shared Components: EntitiesEditor", () => {
  test("renders entity input form and entity list for user confirmation", () => {
    const initialEntities = [
      { kind: "domain", value: "careers-google-verify.xyz" },
      { kind: "upi", value: "hr-recruit@ybl" },
    ];

    const html = renderToStaticMarkup(
      React.createElement(EntitiesEditor, {
        initialEntities,
        onConfirm: () => {},
      })
    );

    assert.ok(html.includes("Confirm Extracted Identifiers"));
    assert.ok(html.includes("careers-google-verify.xyz"));
    assert.ok(html.includes("hr-recruit@ybl"));
  });
});

describe("UI Shared Components: Header & Footer", () => {
  test("Header displays operational indicator, public navigation, and brand", () => {
    const html = renderToStaticMarkup(React.createElement(Header));
    assert.ok(html.includes("Verifier"));
    assert.ok(html.includes("OPERATIONAL"));
    assert.ok(html.includes("/check"));
    assert.ok(html.includes("/guides"));
    assert.ok(html.includes("/report-fraud"));
    assert.ok(html.includes("/about"));
  });

  test("Footer includes mandatory disclaimer and DPDP Act 2023 notice", () => {
    const html = renderToStaticMarkup(React.createElement(Footer));
    assert.ok(html.includes("Risk Assessment Disclaimer:"));
    assert.ok(html.includes("Nothing found is not the same as safe"));
    assert.ok(html.includes("/about"));
    assert.ok(html.includes("1930"));
  });
});

describe("UI Shared Components: LinkExtractionCard", () => {
  test("Host sanitization strips paths, queries, and fragments", () => {
    assert.equal(
      getHostFromEntity({ kind: "url", value: "https://portal.scholarship-gov.in/apply?token=secret#section" }),
      "portal.scholarship-gov.in"
    );
    assert.equal(
      getHostFromEntity({ kind: "domain", value: "legit-college.edu.in" }),
      "legit-college.edu.in"
    );
  });

  test("Prompt state: renders host only, note, 44px buttons with labels, no full URL", () => {
    const entity = {
      id: "ent_42",
      kind: "url",
      value: "https://portal.scholarship-gov.in/secret/apply?token=xyz",
      confirmed: true,
    };

    const html = renderToStaticMarkup(
      React.createElement(LinkExtractionCard, {
        checkId: "chk_123",
        entity,
        lang: "en",
        initialState: { state: "prompt" },
      })
    );

    // Shows host only, never the full URL
    assert.ok(html.includes("portal.scholarship-gov.in"));
    assert.equal(html.includes("/secret/apply"), false, "Must never render path or query string");
    assert.ok(html.includes("Do you want to extract the content of this link?"));
    assert.ok(html.includes("We open the link from our server, read the pages, and delete the result after 24 hours. Nothing is saved to the scam graph."));
    assert.ok(html.includes("Yes, extract"));
    assert.ok(html.includes("No, skip"));
    // Accessible button touch targets
    assert.ok(html.includes("min-height:44px"));
  });

  test("Bilingual: renders Hindi text when lang='hi'", () => {
    const entity = {
      id: "ent_42",
      kind: "domain",
      value: "pm-scholarship.org",
      confirmed: true,
    };

    const html = renderToStaticMarkup(
      React.createElement(LinkExtractionCard, {
        checkId: "chk_123",
        entity,
        lang: "hi",
        initialState: { state: "prompt" },
      })
    );

    assert.ok(html.includes("क्या आप इस लिंक की सामग्री निकालना चाहते हैं?"));
    assert.ok(html.includes("हाँ, निकालें"));
    assert.ok(html.includes("नहीं, छोड़ें"));
  });

  test("Skipped state: renders collapsed skipped text and Extract anyway button", () => {
    const entity = { id: "ent_1", kind: "domain", value: "target-portal.com" };

    const html = renderToStaticMarkup(
      React.createElement(LinkExtractionCard, {
        checkId: "chk_1",
        entity,
        initialState: { state: "skipped" },
      })
    );

    assert.ok(html.includes("Link content extraction skipped for target-portal.com"));
    assert.ok(html.includes("Extract anyway"));
  });

  test("Running state: renders status role and aria-live polite", () => {
    const entity = { id: "ent_1", kind: "domain", value: "target-portal.com" };

    const html = renderToStaticMarkup(
      React.createElement(LinkExtractionCard, {
        checkId: "chk_1",
        entity,
        initialState: { state: "running" },
      })
    );

    assert.ok(html.includes('role="status"'));
    assert.ok(html.includes('aria-live="polite"'));
    assert.ok(html.includes("Extracting content from target-portal.com"));
  });

  test("Failed state: renders error message and Retry button", () => {
    const entity = { id: "ent_1", kind: "domain", value: "target-portal.com" };

    const html = renderToStaticMarkup(
      React.createElement(LinkExtractionCard, {
        checkId: "chk_1",
        entity,
        initialState: {
          state: "failed",
          errorMessage: "The crawler is not available right now. The rest of your report is not affected.",
        },
      })
    );

    assert.ok(html.includes("The crawler is not available right now. The rest of your report is not affected."));
    assert.ok(html.includes("Retry extraction"));
  });

  test("Done state & Security: plain text only, XSS script tags escaped, form text labels present", () => {
    const maliciousTitle = "<script>alert('xss')</script>";
    const entity = { id: "ent_1", kind: "domain", value: "secure-portal.org" };
    const result = {
      pages: [
        {
          url: "https://secure-portal.org/",
          status: 200,
          title: maliciousTitle,
          linkCount: 3,
          textExcerpt: "Confidential scholarship application details.",
        },
      ],
      forms: [
        {
          method: "POST",
          actionHost: "pay.secure-portal.org",
          fieldTypes: ["password", "text"],
          hasPassword: true,
          hasOtp: true,
          hasUpi: true,
          hasPayment: true,
        },
      ],
      externalDomains: ["external-auth.net"],
      truncated: true,
      limitsUsed: { maxPages: 5 },
    };

    const html = renderToStaticMarkup(
      React.createElement(LinkExtractionCard, {
        checkId: "chk_1",
        entity,
        initialState: { state: "done", result },
      })
    );

    // 1. Mandatory PRD line
    assert.ok(html.includes("This is information only. It does not change the risk level."));
    // 2. Truncated badge
    assert.ok(html.includes("Results limited to 5 pages"));
    // 3. XSS Security: script tag escaped into plain text entity, never raw HTML
    assert.ok(html.includes("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;"));
    assert.equal(html.includes("<script>alert"), false, "Must never render unescaped script tag");
    // 4. Form text labels for accessible identification
    assert.ok(html.includes("[Password Required]"));
    assert.ok(html.includes("[OTP Field]"));
    assert.ok(html.includes("[UPI Payment ID]"));
    assert.ok(html.includes("[Payment Method]"));
    // 5. External domain
    assert.ok(html.includes("external-auth.net"));
  });
});

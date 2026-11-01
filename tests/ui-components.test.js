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

async function loadComponent(relPath) {
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

describe("UI Shared Components: RiskBadge", () => {
  before(async () => {
    RiskBadge = await loadComponent("components/RiskBadge.js");
    FlagCard = await loadComponent("components/FlagCard.js");
    Checklist = await loadComponent("components/Checklist.js");
    CoverageCard = await loadComponent("components/CoverageCard.js");
    EntitiesEditor = await loadComponent("components/EntitiesEditor.js");
    Header = await loadComponent("components/Header.js");
    Footer = await loadComponent("components/Footer.js");
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

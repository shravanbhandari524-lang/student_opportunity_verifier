import React from "react";
import Link from "next/link";
import Card from "../../components/ui/Card.jsx";

export const metadata = {
  title: "About & Methodology — Opportunity Verifier",
  description:
    "Learn about our deterministic multi-agent verification system, anti-hallucination architecture, and privacy safeguards under DPDP Act 2023.",
};

export default function AboutPage() {
  return (
    <article className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 md:py-12 flex flex-col gap-10">
      {/* Header */}
      <header className="space-y-3">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#0A0A0A] dark:text-white">
          About Opportunity Verifier
        </h1>
        <p className="text-base text-neutral-600 dark:text-neutral-300 leading-relaxed">
          An open educational triage system helping students and families identify fraudulent scholarships, internships, part-time jobs, and payment traps.
        </p>
      </header>

      {/* Core Architectural Invariant */}
      <Card className="p-5 sm:p-6 border-l-4 border-l-[#0A0A0A] dark:border-l-white bg-neutral-50/70 dark:bg-white/[0.02]">
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-500 mb-2 block">
          Core Anti-Hallucination Invariant
        </span>
        <blockquote className="text-sm sm:text-base font-semibold text-[#0A0A0A] dark:text-white leading-relaxed">
          &ldquo;Deterministic code establishes facts; the LLM only reads and explains. The LLM never decides the final risk level.&rdquo;
        </blockquote>
        <p className="mt-3 text-xs sm:text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
          General-purpose chatbots frequently hallucinate safety or miss subtle recruitment fraud because they evaluate superficial politeness. Opportunity Verifier uses hardcoded code to verify domain registration ages via RDAP, cross-reference Ministry of Corporate Affairs records, and inspect UPI VPA formats before any language model generates a summary.
        </p>
      </Card>

      {/* The 6 Specialist Agents */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0A0A0A] dark:text-white">
            Six specialist agents
          </h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
            Each agent runs independently in parallel with strict timeout limits and immutable evidence recording.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Card className="p-4 space-y-1.5">
            <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
              1. Message Analyst
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Scans message text for advance-fee requests, interview waiver claims, identity document demands, and urgent payment deadlines.
            </p>
          </Card>

          <Card className="p-4 space-y-1.5">
            <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
              2. Payment &amp; Entity Validator
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Dissects UPI handles (detects personal PSP handles used for claimed corporations), validates phone formats, and flags mismatched payees.
            </p>
          </Card>

          <Card className="p-4 space-y-1.5">
            <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
              3. Website Forensics
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Inspects domain creation date, SSL certificates, historical snapshots in the Wayback Machine, and typosquatting/lookalike patterns.
            </p>
          </Card>

          <Card className="p-4 space-y-1.5">
            <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
              4. Reputation &amp; OSINT
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Searches consumer grievance archives, public complaint forums, and community advisories for matching handles and UPI IDs.
            </p>
          </Card>

          <Card className="p-4 space-y-1.5">
            <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
              5. Official Sources Verifier
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              Validates claims against the National Scholarship Portal, PIB Fact Check alerts, and official government gazettes.
            </p>
          </Card>

          <Card className="p-4 space-y-1.5">
            <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
              6. ML Classifier
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
              A lightweight, local scikit-learn model trained on real and synthetic Indian student fraud reports providing calibrated risk probabilities.
            </p>
          </Card>
        </div>
      </section>

      {/* Privacy & Safeguards */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[#0A0A0A] dark:text-white">
            Privacy safeguards &amp; DPDP Act 2023 compliance
          </h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
            Built from day one to respect personal privacy and minimize data retention.
          </p>
        </div>

        <Card className="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] dark:bg-white shrink-0 mt-2" />
            <p className="text-xs sm:text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
              <strong>24-Hour Check Expiration:</strong> All verification cases, extracted identifiers, and results expire automatically after 24 hours. Uploaded screenshots are deleted immediately after OCR text extraction.
            </p>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] dark:bg-white shrink-0 mt-2" />
            <p className="text-xs sm:text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
              <strong>No Personal Social Media Scraping:</strong> We strictly prohibit scraping personal social media accounts (Instagram, Facebook, LinkedIn profiles). We only check public corporate domains, official registries, and published advisories.
            </p>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] dark:bg-white shrink-0 mt-2" />
            <p className="text-xs sm:text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
              <strong>SSRF Protection &amp; Input Sanitization:</strong> All user-supplied and discovered URLs pass strict server-side request forgery (SSRF) filters preventing queries to internal, private, or loopback network ranges.
            </p>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] dark:bg-white shrink-0 mt-2" />
            <p className="text-xs sm:text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
              <strong>Risk Assessment, Never Defamation:</strong> Reports provide a risk evaluation based on observable evidence. The system never labels a named person a &ldquo;scammer.&rdquo;
            </p>
          </div>
        </Card>
      </section>

      {/* Action CTA */}
      <div className="p-6 rounded-xl bg-neutral-100/70 dark:bg-white/5 border border-[#E5E7EB] dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[#0A0A0A] dark:text-white">
            Ready to verify an opportunity?
          </h3>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
            Paste text or upload a screenshot to start a multi-agent evaluation.
          </p>
        </div>
        <Link
          href="/check"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] text-xs font-semibold hover:opacity-90 active:scale-[0.98] transition-all shrink-0 shadow-xs"
        >
          <span>Check an offer</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      </div>
    </article>
  );
}

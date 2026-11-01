import Link from "next/link";

export const metadata = {
  title: "About & Architecture | Opportunity Verifier",
  description:
    "Learn about the deterministic multi-agent verification engine, DPDP Act 2023 privacy safeguards, and anti-hallucination scoring.",
};

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="font-mono text-xs uppercase text-zinc-500 tracking-wider">
            Architecture, Methodology &amp; DPDP Safeguards
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          About Opportunity Verifier
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
          An open, evidence-backed security workspace engineered to protect Indian college students and job seekers from predatory internships, fake scholarships, task scams, and money-mule entrapment.
        </p>
      </div>

      {/* Core Principle Banner */}
      <section className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md flex flex-col gap-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          The Core Invariant: Deterministic Facts, Not AI Hallucination
        </h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Standard consumer AI chatbots frequently hallucinate safety or miss deceptive fraud patterns because they attempt to &ldquo;guess&rdquo; legitimacy from surface tone. Opportunity Verifier enforces a strict mathematical separation:
        </p>

        <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 border-l-4 border-zinc-900 dark:border-zinc-100 rounded text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100">
          &ldquo;Deterministic code establishes facts; the LLM only reads and explains. The LLM never decides the final risk score.&rdquo;
        </div>

        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          When an offer claims to represent a ministry scheme, code validates whether the domain resolves to an authoritative <code className="font-mono text-zinc-900 dark:text-zinc-100">.gov.in</code> or <code className="font-mono text-zinc-900 dark:text-zinc-100">.nic.in</code> host. When an HR representative requests a deposit, code validates the UPI VPA pattern against known corporate structures.
        </p>
      </section>

      {/* The 6 Specialist Agents */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md p-5 flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            The 6 Canonical Specialist Agents
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
            Operating via a blackboard coordinator pattern across 2 iterative rounds of evidence discovery.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              1. Message &amp; Offer Analyst
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Analyzes predatory conversational tactics, urgency pressure, interview-less selection, and fee demands. Validates quoted text spans with contiguous span snapping.
            </p>
          </div>

          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              2. Domain &amp; Web Forensics
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Inspects domain registration age via authoritative RDAP, nameserver infrastructure, SSL certificate provenance, lookalike typosquatting, Wayback archive records, and threat feeds.
            </p>
          </div>

          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              3. Official Registry Verifier
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Cross-references claims against authentic gazettes, the National Scholarship Portal, MCA corporate registrations, UGC university listings, and PIB Fact Check bulletins.
            </p>
          </div>

          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              4. Community &amp; OSINT Search
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Executes targeted search dorks across consumer complaint boards, Reddit, Trustpilot, and threat repositories to locate established victim discussions without automated scraping.
            </p>
          </div>

          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              5. Payment &amp; UPI Verifier
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Validates UPI VPA syntax, payee bank handles, personal payment demands for institutional schemes, phone number formatting, and checks against the local scam intelligence graph.
            </p>
          </div>

          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              6. ML Scam Classifier
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Trained scikit-learn Logistic Regression model evaluated on real-world Indian scholarship and job fraud datasets. Points are scaled linearly without overriding agent facts.
            </p>
          </div>
        </div>
      </section>

      {/* Privacy & DPDP Act 2023 Safeguards */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md p-5 flex flex-col gap-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Digital Personal Data Protection (DPDP) Act 2023 Safeguards
        </h2>
        <ul className="list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 leading-relaxed">
          <li>
            <strong>Zero Long-Term Storage:</strong> User screenshots are permanently deleted immediately following OCR vision extraction.
          </li>
          <li>
            <strong>24-Hour Check Expiration:</strong> All check records, message text, and analysis files expire and are automatically purged from the database after 24 hours.
          </li>
          <li>
            <strong>No Identity Scraping:</strong> We do not scrape Instagram, Facebook, or LinkedIn profiles. Phone numbers are validated only for syntax and scam-report matching, never traced or geo-located.
          </li>
          <li>
            <strong>Non-Defamation Standard:</strong> Output is strictly a risk assessment of an opportunity circular based on verifiable public evidence, never an accusation that an individual is a criminal.
          </li>
          <li>
            <strong>SSRF &amp; Prompt-Injection Hardening:</strong> All discovered URLs pass strict server-side request forgery guards (blocking private, loopback, and local IP ranges). Untrusted text is strictly rendered as plain text.
          </li>
        </ul>
      </section>

      {/* Safety Invariant Notice */}
      <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 rounded-md text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
        <strong>Important Verification Invariant:</strong> The absence of red flags does not mean an offer is guaranteed authentic. Missing evidence yields a <code className="font-mono text-zinc-900 dark:text-zinc-100">CANNOT_VERIFY</code> assessment. Always cross-check independently with your college placement cell or student welfare officer.
      </div>

      {/* Bottom CTA */}
      <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-800 pt-4">
        <span className="text-xs text-zinc-500 font-mono">
          Ready to inspect a suspicious communication?
        </span>
        <Link
          href="/check"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-semibold text-xs rounded transition-colors"
        >
          <span>Start an offer check</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}

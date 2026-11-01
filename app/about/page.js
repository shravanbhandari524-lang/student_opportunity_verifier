import Link from "next/link";

export const metadata = {
  title: "About & Privacy | Opportunity Verifier",
  description: "Learn about the architecture, deterministic verification engine, and DPDP Act 2023 privacy safeguards.",
};

export default function AboutPage() {
  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "2.5rem" }}>
      <div>
        <h1 style={{ fontSize: "2.2rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          About Opportunity Verifier
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem", fontSize: "1.05rem", lineHeight: 1.6 }}>
          An evidence-backed system designed to protect students and recent graduates from predatory scams, fake internships, and mule-account entrapment.
        </p>
      </div>

      {/* Core Principle Card */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>
          Deterministic Verification, Not Guesswork
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.6 }}>
          Most AI systems hallucinate confidence without checking real-world facts. Opportunity Verifier is built on a strict technical invariant:
        </p>
        <div
          style={{
            padding: "1rem 1.25rem",
            backgroundColor: "var(--bg-card-subtle)",
            borderLeft: "3px solid var(--accent-primary)",
            borderRadius: "var(--radius-sm)",
            fontSize: "0.92rem",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          &quot;Deterministic code establishes facts; the LLM only reads and explains. The LLM never decides the final risk score.&quot;
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.6 }}>
          When an offer claims to represent a government department, our domain agent verifies whether it actually resides on an official <code style={{ fontFamily: "var(--font-mono)" }}>.gov.in</code> or <code style={{ fontFamily: "var(--font-mono)" }}>.nic.in</code> domain. When a recruiter provides a personal UPI ID for a training fee, our payment agent evaluates UPI ID format, payee consistency and known-scam database match.
        </p>
      </section>

      {/* Specialist Agents */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>The 6 Specialist Agents</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.92rem" }}>
          <div style={{ padding: "0.75rem", backgroundColor: "var(--bg-card-subtle)", borderRadius: "var(--radius-sm)" }}>
            <strong>1. Domain & Web Intelligence Agent:</strong> Inspects domain age, RDAP registration records, lookalike typosquatting, and SSL validity.
          </div>
          <div style={{ padding: "0.75rem", backgroundColor: "var(--bg-card-subtle)", borderRadius: "var(--radius-sm)" }}>
            <strong>2. Payment & UPI Verifier:</strong> Examines UPI handles, payment aggregators, personal VPAs, and advance-fee structures.
          </div>
          <div style={{ padding: "0.75rem", backgroundColor: "var(--bg-card-subtle)", borderRadius: "var(--radius-sm)" }}>
            <strong>3. Content & ML Classifier:</strong> Scans message language for predatory task patterns, urgent deposit coercion, and known scam phrasing.
          </div>
          <div style={{ padding: "0.75rem", backgroundColor: "var(--bg-card-subtle)", borderRadius: "var(--radius-sm)" }}>
            <strong>4. Video & Media Checker:</strong> Analyzes YouTube video links and comments promoting fake part-time video rating gigs.
          </div>
          <div style={{ padding: "0.75rem", backgroundColor: "var(--bg-card-subtle)", borderRadius: "var(--radius-sm)" }}>
            <strong>5. Community & OSINT Agent:</strong> Searches official public cyber advisories, PIB fact checks, and consumer fraud reports.
          </div>
          <div style={{ padding: "0.75rem", backgroundColor: "var(--bg-card-subtle)", borderRadius: "var(--radius-sm)" }}>
            <strong>6. Official Identity Verifier:</strong> Cross-references Ministry of Corporate Affairs (MCA), National Scholarship Portal (NSP), and official portals.
          </div>
        </div>
      </section>

      {/* Privacy & DPDP Compliance */}
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>
          Privacy Safeguards & DPDP Act 2023 Compliance
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.6 }}>
          Designed with India&apos;s Digital Personal Data Protection Act, 2023 in mind:
        </p>
        <ul style={{ paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          <li><strong>No permanent image retention:</strong> Uploaded screenshots are processed in memory and permanently deleted immediately upon OCR extraction.</li>
          <li><strong>24-Hour Check Expiration:</strong> All check sessions and raw submitted text automatically expire and are purged after 24 hours.</li>
          <li><strong>No Personal Accusations:</strong> The system produces objective risk assessments based on public evidence, never legal accusations or tracing of private individuals.</li>
          <li><strong>Opt-In Public Graph:</strong> Only malicious identifiers (domains, scam VPAs) from confirmed high-risk checks are recorded in our shared scam database — and only with your explicit consent.</li>
        </ul>
      </section>

      {/* Emergency Helplines */}
      <section
        style={{
          padding: "1.5rem",
          backgroundColor: "var(--bg-card-subtle)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700 }}>Official Indian Cyber Safety Helplines</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", fontSize: "0.9rem" }}>
          <div>
            <strong>Cyber Crime Helpline:</strong>
            <p style={{ color: "var(--accent-primary)", fontWeight: 700, fontSize: "1.1rem" }}>1930</p>
          </div>
          <div>
            <strong>National Cyber Crime Portal:</strong>
            <p><a href="https://cybercrime.gov.in" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary)" }}>cybercrime.gov.in</a></p>
          </div>
          <div>
            <strong>Sanchar Saathi (Chakshu):</strong>
            <p><a href="https://sancharsaathi.gov.in" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary)" }}>sancharsaathi.gov.in</a></p>
          </div>
        </div>
      </section>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <Link href="/check" className="btn-primary" style={{ padding: "0.75rem 1.8rem" }}>
          Verify an Opportunity Now →
        </Link>
      </div>
    </div>
  );
}

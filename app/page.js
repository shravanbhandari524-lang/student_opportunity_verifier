import Link from "next/link";
import RecentChecks from "../components/RecentChecks.js";

const SCAM_ARCHETYPES = [
  {
    type: "scholarship_scam",
    title: "Fake Scholarship",
    badge: "Government / NGO",
    pattern: "WhatsApp or SMS circulars claiming eligibility for high scholarships under central or state schemes.",
    signals: "Demands processing/registration fees, non-.gov.in domains, unlisted schemes, or APK download links.",
    icon: "🎓",
  },
  {
    type: "job_internship_scam",
    title: "Fake Internship or Job",
    badge: "Recruitment / HR",
    pattern: "Direct offer letters without technical interviews, impersonating reputed technology corporations or MNCs.",
    signals: "Security/laptop deposits, free Gmail/Outlook HR addresses, personal UPI IDs, or copied offer templates.",
    icon: "💼",
  },
  {
    type: "task_gig_scam",
    title: "Task & Part-Time Gigs",
    badge: "Telegram / Payout",
    pattern: "Work-from-home offers promising ₹3,000–₹5,000/day for liking videos, rating map locations, or reviewing hotels.",
    signals: "Small initial payout to establish false trust, followed by mandatory prepaid deposit tasks to release funds.",
    icon: "📱",
  },
  {
    type: "money_mule_scam",
    title: "Money Mule Offer",
    badge: "Bank Account / Crime",
    pattern: "Requests to 'rent out your bank account' or receive third-party funds in exchange for high commissions.",
    signals: "Requests for ATM cards, netbanking credentials, OTP sharing; creates severe personal criminal liability.",
    icon: "🏦",
  },
  {
    type: "competition_certificate_scam",
    title: "Fake Competition & Certificates",
    badge: "Contest / Award",
    pattern: "Hackathons, essay contests, or case studies charging entry fees and promising instant verified certificates.",
    signals: "Borrowed enterprise logos, unverifiable organizers, pay-to-receive prestige awards with no evaluation.",
    icon: "🏆",
  },
  {
    type: "overseas_admission_scam",
    title: "Overseas Study & Visa Agent",
    badge: "Study Abroad / Visa",
    pattern: "Unlicensed agents guaranteeing direct foreign university admission or student visa bypasses without IELTS.",
    signals: "Large upfront cash/crypto deposits to personal accounts, forged admission letters, refusal to sign contracts.",
    icon: "✈️",
  },
];

export const metadata = {
  title: "Verifier | Forensic Multi-Agent Opportunity Authenticity",
  description:
    "Deterministic multi-agent verification workspace for institutional authenticity, scholarship validation, and job offer fraud triage.",
};

export default function HomePage() {
  return (
    <div className="container-wide" style={{ padding: "2rem 1rem 4rem 1rem" }}>
      {/* Hero Header */}
      <section style={{ marginBottom: "2.5rem" }} aria-labelledby="hero-title">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.75rem" }}>
          <span className="status-dot emerald" aria-hidden="true" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: "0.05em" }}>
            Forensic Runtime Engine · Cluster Alpha Online
          </span>
        </div>

        <h1
          id="hero-title"
          style={{
            fontSize: "clamp(28px, 4vw, 42px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: "var(--text-primary)",
            lineHeight: 1.15,
            marginBottom: "0.75rem",
          }}
        >
          Verify Scholarships, Jobs &amp; Student Offers
        </h1>

        <p
          style={{
            fontSize: "15px",
            color: "var(--text-secondary)",
            maxWidth: "75ch",
            lineHeight: 1.6,
          }}
        >
          Deterministic multi-agent verification workspace. Cross-references suspicious WhatsApp messages, offer letters, UPI IDs, and domain records against authentic government gazettes, corporate registries, and threat databases.
        </p>
      </section>

      {/* Quick Action / Triage Guidance Banner */}
      <section
        className="panel-subtle"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1.25rem",
          marginBottom: "2.5rem",
          borderLeft: "4px solid var(--accent-primary)",
        }}
        aria-label="Quick Check Opportunity"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "700px" }}>
          <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>
            Received a suspicious internship letter, task offer, or scholarship circular?
          </span>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Paste message text, upload offer screenshots, or enter payment identifiers. Our 6 specialist agents check facts in parallel and produce an evidence-backed risk assessment with a next-steps checklist.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link href="/check" className="btn btn-primary" style={{ padding: "9px 18px", fontSize: "14px", fontWeight: 600 }}>
            <span>Start new check</span>
            <span aria-hidden="true">→</span>
          </Link>
          <Link href="/guides" className="btn btn-secondary" style={{ padding: "9px 16px", fontSize: "14px" }}>
            Explore guides
          </Link>
        </div>
      </section>

      {/* Architecture & Telemetry Highlights (4 Metrics) */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "2.5rem",
        }}
        aria-label="Engine Specifications"
      >
        {[
          { label: "Specialist Agents", val: "6 Agents", desc: "Parallel forensic inquiry" },
          { label: "Pipeline Depth", val: "2 Rounds", desc: "Autonomous entity discovery" },
          { label: "Scoring Principle", val: "Pure Code", desc: "Zero LLM risk hallucination" },
          { label: "Privacy Standard", val: "DPDP 2023", desc: "No permanent PII retention" },
        ].map((stat, idx) => (
          <div key={idx} className="panel" style={{ padding: "1rem" }}>
            <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {stat.label}
            </span>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginTop: "4px" }}>
              {stat.val}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
              {stat.desc}
            </div>
          </div>
        ))}
      </section>

      {/* 6 Scam Archetypes Grid */}
      <section aria-labelledby="archetypes-heading" style={{ marginBottom: "2.5rem" }}>
        <div className="panel-header" style={{ marginBottom: "1.25rem" }}>
          <div>
            <h2 id="archetypes-heading" style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>
              The 6 Primary Student Scam Archetypes
            </h2>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
              Recognize the predatory patterns targeting college students, job seekers, and parents.
            </p>
          </div>
          <Link href="/guides" className="btn btn-secondary btn-sm">
            View all guides →
          </Link>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "1rem",
          }}
        >
          {SCAM_ARCHETYPES.map((scam) => (
            <div
              key={scam.type}
              className="panel"
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <span style={{ fontSize: "22px" }} aria-hidden="true">{scam.icon}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px",
                      padding: "2px 6px",
                      backgroundColor: "var(--bg-muted)",
                      borderRadius: "var(--radius-xs)",
                      color: "var(--text-secondary)",
                      textTransform: "uppercase",
                    }}
                  >
                    {scam.badge}
                  </span>
                </div>

                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.35rem" }}>
                  {scam.title}
                </h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "0.5rem" }}>
                  {scam.pattern}
                </p>

                <div
                  style={{
                    padding: "6px 8px",
                    backgroundColor: "var(--bg-subtle)",
                    borderLeft: "2px solid var(--status-crimson)",
                    borderRadius: "var(--radius-xs)",
                    fontSize: "12px",
                    color: "var(--text-primary)",
                  }}
                >
                  <strong style={{ color: "var(--status-crimson-text)" }}>Red Flags:</strong> {scam.signals}
                </div>
              </div>

              <div style={{ paddingTop: "0.5rem", borderTop: "1px solid var(--border-divider)" }}>
                <Link
                  href={`/guides/${scam.type}`}
                  className="btn btn-ghost btn-sm"
                  style={{ width: "100%", justifyContent: "space-between" }}
                >
                  <span>Read verification guide</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Checks from Local Device */}
      <RecentChecks />
    </div>
  );
}

import Link from "next/link";

const SCAM_ARCHETYPES = [
  {
    title: "Fake Scholarship",
    pattern: "WhatsApp or SMS links promising selection for government schemes or awards.",
    signals: "Registration fees, non-.gov.in domains, unlisted schemes, or APK download links.",
    icon: "🎓",
  },
  {
    title: "Fake Internship or Job",
    pattern: "Direct offer letters without an interview, impersonating well-known tech firms.",
    signals: "Security/laptop deposits, free Gmail/Outlook HR addresses, personal UPI IDs.",
    icon: "💼",
  },
  {
    title: "Task & Part-Time Gigs",
    pattern: "Telegram work-from-home gigs promising ₹3,000–₹5,000/day for liking videos or rating maps.",
    signals: "Small initial payout to build trust, followed by mandatory prepaid deposit tasks.",
    icon: "📱",
  },
  {
    title: "Money Mule Offer",
    pattern: "Requests to 'rent out your bank account' or receive transfers for high commissions.",
    signals: "Demands for ATM cards, OTPs, or bank netbanking logins; leads to criminal liability.",
    icon: "🏦",
  },
  {
    title: "Fake Competition & Certificates",
    pattern: "Contests charging entry fees and offering instant verified prestige certificates.",
    signals: "Borrowed logos, unverifiable organizers, sold certificates with no real judging.",
    icon: "🏆",
  },
  {
    title: "Overseas Study & Visa Agent",
    pattern: "Agents guaranteeing foreign university admission or student visa bypasses.",
    signals: "Large cash/crypto deposits to personal accounts and forged admission letters.",
    icon: "✈️",
  },
];

export default function HomePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3.5rem" }}>
      {/* Hero Section */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
          alignItems: "flex-start",
          maxWidth: "800px",
          paddingTop: "1rem",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.3rem 0.8rem",
            backgroundColor: "var(--accent-light)",
            color: "var(--accent-primary)",
            borderRadius: "var(--radius-full)",
            fontSize: "0.85rem",
            fontWeight: 600,
          }}
        >
          <span>Evidence-Backed Verification for Students</span>
        </div>

        <h1
          style={{
            fontSize: "clamp(2.2rem, 4.5vw, 3.25rem)",
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: "-0.03em",
          }}
        >
          Check suspicious student opportunities before you pay or share details.
        </h1>

        <p
          style={{
            fontSize: "1.12rem",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            maxWidth: "68ch",
          }}
        >
          Received a job offer asking for a training deposit? A Telegram gig paying for YouTube likes?
          A scholarship claiming government sponsorship on a strange website? We run multi-agent
          investigations across official domains, UPI handles, and scam registries to deliver an
          evidence-backed risk report.
        </p>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          <Link href="/check" className="btn-primary" style={{ padding: "0.8rem 1.6rem", fontSize: "1rem" }}>
            Check an Offer Now →
          </Link>
          <a href="#how-it-works" className="btn-secondary" style={{ padding: "0.8rem 1.4rem", fontSize: "1rem" }}>
            How Verification Works
          </a>
        </div>
      </section>

      {/* 3 Steps: Grounded and Direct */}
      <section id="how-it-works" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.65rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
            How it works in 3 transparent steps
          </h2>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem", fontSize: "0.95rem" }}>
            Deterministic code and specialist agents establish facts. The LLM only summarizes and explains.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "1.25rem",
          }}
        >
          <div className="card">
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--accent-primary)",
                marginBottom: "0.5rem",
              }}
            >
              01
            </div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.35rem" }}>
              Submit offer signals
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.92rem", lineHeight: 1.5 }}>
              Paste the offer message, upload chat screenshots, or provide the website link, company name, and UPI ID.
            </p>
          </div>

          <div className="card">
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--accent-primary)",
                marginBottom: "0.5rem",
              }}
            >
              02
            </div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.35rem" }}>
              Multi-agent fact check
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.92rem", lineHeight: 1.5 }}>
              Specialist agents inspect domain age, typosquatting, official .gov.in status, UPI patterns, and scam database hits in parallel.
            </p>
          </div>

          <div className="card">
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--accent-primary)",
                marginBottom: "0.5rem",
              }}
            >
              03
            </div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.35rem" }}>
              Evidence report & checklist
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.92rem", lineHeight: 1.5 }}>
              Get an objective risk assessment (Low, Medium, High, or Cannot Verify) with verifiable quotes, source links, and next verification steps.
            </p>
          </div>
        </div>
      </section>

      {/* Scam Archetypes Grid */}
      <section style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.65rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
            Common patterns targeted at students
          </h2>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem", fontSize: "0.95rem" }}>
            The 6 primary patterns analyzed by our verification engine.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "1.25rem",
          }}
        >
          {SCAM_ARCHETYPES.map((scam) => (
            <div
              key={scam.title}
              className="card card-interactive"
              style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ fontSize: "1.35rem" }} role="img" aria-label={scam.title}>
                  {scam.icon}
                </span>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 600 }}>{scam.title}</h3>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5 }}>
                {scam.pattern}
              </p>
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: "0.65rem",
                  borderTop: "1px solid var(--border-subtle)",
                  fontSize: "0.82rem",
                  color: "var(--text-muted)",
                }}
              >
                <strong style={{ color: "var(--text-primary)" }}>Warning signs:</strong> {scam.signals}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Safety CTA */}
      <section
        className="card"
        style={{
          backgroundColor: "var(--bg-card-subtle)",
          padding: "2.5rem 2rem",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1rem",
        }}
      >
        <h2 style={{ fontSize: "1.75rem", fontWeight: 700 }}>
          Received an offer that feels questionable?
        </h2>
        <p style={{ maxWidth: "600px", color: "var(--text-secondary)", fontSize: "0.98rem" }}>
          Never pay upfront registration, security deposits, or uniform fees. Check an offer before you act in seconds.
        </p>
        <Link href="/check" className="btn-primary" style={{ padding: "0.75rem 1.5rem" }}>
          Verify an Opportunity Now →
        </Link>
      </section>
    </div>
  );
}

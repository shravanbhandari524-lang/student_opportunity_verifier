import Link from "next/link";

const SCAM_TYPES = [
  {
    title: "Fake Scholarship",
    pattern: "WhatsApp or SMS links promising selection for government schemes or awards.",
    signals: "Registration fees, non-.gov.in domains, unlisted schemes, or APK downloads.",
    icon: "🎓",
  },
  {
    title: "Fake Internship or Job",
    pattern: "Direct offer letters without an interview, often impersonating reputed companies.",
    signals: "Upfront training/security deposits, free-mail HR addresses, personal UPI IDs.",
    icon: "💼",
  },
  {
    title: "Task or Part-Time Job",
    pattern: "Telegram or WhatsApp work-from-home gigs claiming 'like videos to earn ₹5,000/day'.",
    signals: "Small token payouts followed by mandatory deposits for higher VIP tasks.",
    icon: "📱",
  },
  {
    title: "Money Mule Offer",
    pattern: "Requests to 'rent out your bank account' or transfer money for high commissions.",
    signals: "Demands for bank logins, ATM cards, or SIM cards; leads directly to cybercrime liability.",
    icon: "🏦",
  },
  {
    title: "Fake Competition or Certificate",
    pattern: "Contests charging entry fees and offering instant verified certificates.",
    signals: "Borrowed logos, unverifiable organizers, sold certificates with no real judging.",
    icon: "🏆",
  },
  {
    title: "Overseas Study or Visa Agent",
    pattern: "Agents guaranteeing foreign university admission or student visa bypasses.",
    signals: "Large cash/crypto deposits to personal accounts and forged admission letters.",
    icon: "✈️",
  },
];

export default function HomePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4rem" }}>
      {/* Hero Section */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          alignItems: "flex-start",
          maxWidth: "800px",
          paddingTop: "1.5rem",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.35rem 0.85rem",
            background: "var(--accent-light)",
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
            fontSize: "clamp(2.2rem, 4vw, 3.2rem)",
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: "-0.03em",
          }}
        >
          Check suspicious student offers before you pay or share details.
        </h1>

        <p
          style={{
            fontSize: "1.15rem",
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            maxWidth: "65ch",
          }}
        >
          Submit WhatsApp messages, internship emails, scholarship links, or payment IDs.
          Our automated investigation checks government registries, domain history, and payment patterns
          to give you clear risk facts and next steps.
        </p>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          <Link href="/check" className="btn-primary">
            Check an offer now →
          </Link>
          <a href="#how-it-works" className="btn-secondary">
            How verification works
          </a>
        </div>
      </section>

      {/* How it Works: 3 Steps */}
      <section id="how-it-works" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        <div>
          <h2 style={{ fontSize: "1.8rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
            How it works in 3 steps
          </h2>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem" }}>
            Transparent verification grounded in verifiable sources, never guesswork.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "1.5rem",
          }}
        >
          <div className="card">
            <div
              style={{
                fontSize: "1.75rem",
                fontWeight: 800,
                color: "var(--accent-primary)",
                marginBottom: "0.75rem",
              }}
            >
              01
            </div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Submit offer details
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
              Paste the offer message, upload chat screenshots, or provide the website link, company name, and UPI ID.
            </p>
          </div>

          <div className="card">
            <div
              style={{
                fontSize: "1.75rem",
                fontWeight: 800,
                color: "var(--accent-primary)",
                marginBottom: "0.75rem",
              }}
            >
              02
            </div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Automated multi-source check
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
              The system inspects domain age, official government portals (.gov.in), known payment flags, and community reports in parallel.
            </p>
          </div>

          <div className="card">
            <div
              style={{
                fontSize: "1.75rem",
                fontWeight: 800,
                color: "var(--accent-primary)",
                marginBottom: "0.75rem",
              }}
            >
              03
            </div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Evidence report & checklist
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem" }}>
              Receive an objective risk assessment (Low, Medium, High, or Cannot Verify) with source citations and a checklist of what to verify next.
            </p>
          </div>
        </div>
      </section>

      {/* Six Scam Types from PRD */}
      <section style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
        <div>
          <h2 style={{ fontSize: "1.8rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
            Common patterns targeted at students
          </h2>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem" }}>
            The 6 primary offer patterns evaluated by our verification pipeline.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "1.5rem",
          }}
        >
          {SCAM_TYPES.map((scam) => (
            <div key={scam.title} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ fontSize: "1.5rem" }} role="img" aria-label={scam.title}>
                  {scam.icon}
                </span>
                <h3 style={{ fontSize: "1.15rem", fontWeight: 600 }}>{scam.title}</h3>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5 }}>
                {scam.pattern}
              </p>
              <div
                style={{
                  marginTop: "auto",
                  paddingTop: "0.75rem",
                  borderTop: "1px solid var(--border-subtle)",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                }}
              >
                <strong style={{ color: "var(--text-primary)" }}>Key signals:</strong> {scam.signals}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Call to Action Banner */}
      <section
        className="card"
        style={{
          background: "linear-gradient(135deg, var(--bg-card), var(--bg-subtle))",
          padding: "3rem 2rem",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.25rem",
        }}
      >
        <h2 style={{ fontSize: "2rem", fontWeight: 700 }}>
          Received an offer that feels too good to be true?
        </h2>
        <p style={{ maxWidth: "600px", color: "var(--text-secondary)", fontSize: "1.05rem" }}>
          Never pay upfront registration or application fees without verifying. Check the offer in seconds.
        </p>
        <Link href="/check" className="btn-primary">
          Verify an opportunity now →
        </Link>
      </section>
    </div>
  );
}

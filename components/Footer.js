import Link from "next/link.js";

export default function Footer() {
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="container-wide">
        {/* Mandatory PRD Disclaimer Banner */}
        <div className="disclaimer-banner" role="note">
          <strong>Risk Assessment Disclaimer:</strong> Opportunity Verifier performs automated verification against public gazettes, domain intelligence, and scam advisories. It is an educational risk assessment, never a statement that a named person is a scammer or a definitive legal verdict. <em>Nothing found is not the same as safe.</em>
        </div>

        {/* Footer Links & Metadata */}
        <div className="footer-bottom">
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Verifier v2.8</span>
            <Link href="/about" className="nav-link">About & Architecture</Link>
            <Link href="/guides" className="nav-link">Scam Archetypes</Link>
            <Link href="/report-fraud" className="nav-link">Emergency Helpline (1930)</Link>
          </div>
          <div>
            <span>India DPDP Act 2023 Compliant · Zero Content Persistence · 24h Check TTL</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

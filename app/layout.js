import Link from "next/link";
import FinalReportNavLink from "../components/FinalReportNavLink.js";
import "./globals.css";

export const metadata = {
  title: "Opportunity Verifier | Student Digital Safety & Scam Check",
  description:
    "Evidence-backed risk assessment for suspicious scholarships, internships, task gigs, and student opportunities. Multi-agent fact verification with actionable checklists.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <header className="site-header">
          <div className="header-inner">
            <Link href="/" className="brand-link" aria-label="Opportunity Verifier Home">
              <span className="brand-shield" aria-hidden="true">🛡️</span>
              <span>Opportunity Verifier</span>
            </Link>
            <nav className="nav-links" aria-label="Main Navigation">
              <Link href="/check" className="nav-item">
                Check an Offer
              </Link>
              <FinalReportNavLink />
              <Link href="/debug" className="nav-item">
                Investigation Process
              </Link>
              <Link href="/guides" className="nav-item">
                Scam Guides
              </Link>
              <Link href="/about" className="nav-item">
                About & Privacy
              </Link>
              <Link href="/check" className="nav-cta">
                Verify Now
              </Link>
            </nav>
          </div>
        </header>

        <main className="main-content">
          {children}
        </main>

        <footer className="site-footer">
          <div className="footer-inner">
            <div className="disclaimer-box">
              <strong>Assessment Disclaimer:</strong> This system provides risk indicators and fact checks based exclusively on public signals, official registries, and verifiable evidence. It is a risk assessment intended for educational and verification guidance, never a legal verdict or personal accusation.
            </div>
            <div className="footer-meta">
              <span>© {new Date().getFullYear()} Opportunity Verifier. Built for student safety & awareness.</span>
              <span>In compliance with DPDP Act 2023: No user chats or media are permanently retained.</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

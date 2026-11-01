import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Opportunity Verifier | Student Scam Detection",
  description: "Investigate suspicious scholarship, internship, task job, and mule account offers with multi-source evidence.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="header-inner">
            <Link href="/" className="brand-link" aria-label="Opportunity Verifier Home">
              <span className="brand-shield" aria-hidden="true">🛡️</span>
              <span>Opportunity Verifier</span>
            </Link>
            <nav className="nav-links" aria-label="Main Navigation">
              <Link href="/check" className="nav-cta">
                Check an Offer
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
              <strong>Assessment Disclaimer:</strong> This system provides risk indicators and fact checks based exclusively on public signals, official domain registries, and verifiable evidence. It is a risk assessment intended for educational and verification guidance, never a legal verdict or personal accusation.
            </div>
            <div className="footer-meta">
              <span>© {new Date().getFullYear()} Opportunity Verifier. Built for student digital safety.</span>
              <span>No user chats or screenshot media are retained.</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

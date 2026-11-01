import Header from "../components/Header.js";
import Footer from "../components/Footer.js";
import "./globals.css";

export const metadata = {
  title: "Verifier | Student Digital Safety & Opportunity Authenticity",
  description:
    "Deterministic multi-agent verification workspace for institutional authenticity, scholarship validation, and job offer fraud triage.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Header />
        <main id="main-content" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}

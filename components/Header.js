"use client";

import { useState, useEffect } from "react";
import Link from "next/link.js";
import { usePathname } from "next/navigation.js";

export default function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    // Read saved theme
    const savedTheme = localStorage.getItem("ov_theme");
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute("data-theme", savedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    }

    // Read saved language preference
    const savedLang = localStorage.getItem("ov_language");
    if (savedLang) {
      setLang(savedLang);
    }
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("ov_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  function toggleLanguage() {
    const next = lang === "en" ? "hi" : "en";
    setLang(next);
    localStorage.setItem("ov_language", next);
    window.dispatchEvent(new CustomEvent("languagechange", { detail: next }));
  }

  const navItems = [
    { href: "/check", label: lang === "hi" ? "नई जाँच" : "New check" },
    { href: "/guides", label: lang === "hi" ? "घोटाला गाइड" : "Guides" },
    { href: "/report-fraud", label: lang === "hi" ? "शिकायत दर्ज करें" : "Report fraud" },
    { href: "/about", label: lang === "hi" ? "विवरण और गोपनीयता" : "About" },
  ];

  return (
    <header className="site-header" role="banner">
      <div className="container-wide header-inner">
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link href="/" className="brand-wrap" aria-label="Opportunity Verifier Home">
            <span className="brand-title">Verifier</span>
            <span className="badge-version">v2.8</span>
          </Link>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "2px 8px",
              backgroundColor: "var(--bg-muted)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-sm)",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              color: "var(--text-secondary)",
            }}
            className="hidden-sm"
          >
            <span className="status-dot emerald" aria-hidden="true" />
            <span>OPERATIONAL</span>
          </div>
        </div>

        {/* Desktop Nav */}
        <nav
          className={`nav-links ${mobileMenuOpen ? "open" : ""}`}
          aria-label="Main Navigation"
        >
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${isActive ? "active" : ""}`}
                style={{
                  fontWeight: isActive ? 600 : 500,
                  borderBottom: isActive ? "2px solid var(--accent-primary)" : "none",
                  paddingBottom: "2px",
                }}
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "0.5rem" }}>
            {/* Language Switch */}
            <button
              type="button"
              onClick={toggleLanguage}
              className="btn btn-secondary btn-sm"
              aria-label={`Switch language, currently ${lang === "en" ? "English" : "Hindi"}`}
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <span style={{ fontWeight: lang === "en" ? 700 : 400 }}>EN</span>
              <span style={{ color: "var(--text-muted)" }}>/</span>
              <span style={{ fontWeight: lang === "hi" ? 700 : 400 }}>हि</span>
            </button>

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="btn btn-secondary btn-sm"
              aria-label={`Toggle theme, currently ${theme} mode`}
              title="Toggle theme"
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>

            {/* Check CTA */}
            <Link href="/check" className="nav-cta" onClick={() => setMobileMenuOpen(false)}>
              <span>{lang === "hi" ? "जाँच करें" : "Check offer"}</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </nav>

        {/* Mobile Hamburger Button */}
        <button
          type="button"
          className="btn-mobile-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </div>
    </header>
  );
}

"use client";

import { useState, useEffect } from "react";
import Link from "next/link.js";
import { usePathname } from "next/navigation.js";

export default function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const [theme, setTheme] = useState("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem("ov_theme");
    if (savedTheme) {
      setTheme(savedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }

    const savedLang = localStorage.getItem("ov_language");
    if (savedLang) {
      setLang(savedLang);
    }
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Close mobile drawer on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
      }
    }
    if (mobileMenuOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("ov_theme", next);
    document.documentElement.setAttribute("data-theme", next);
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  function toggleLanguage() {
    const next = lang === "en" ? "hi" : "en";
    setLang(next);
    localStorage.setItem("ov_language", next);
    window.dispatchEvent(new CustomEvent("languagechange", { detail: next }));
  }

  const navItems = [
    { href: "/check", label: lang === "hi" ? "नई जाँच" : "New check" },
    { href: "/history", label: lang === "hi" ? "इतिहास" : "History" },
    { href: "/guides", label: lang === "hi" ? "घोटाला गाइड" : "Guides" },
    { href: "/report-fraud", label: lang === "hi" ? "शिकायत दर्ज करें" : "Report fraud" },
    { href: "/about", label: lang === "hi" ? "विवरण और गोपनीयता" : "About" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#E5E7EB] dark:border-white/10 bg-white/90 dark:bg-[#0A0A0C]/90 backdrop-blur-md transition-colors">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-semibold text-base tracking-tight text-[#0A0A0A] dark:text-white hover:opacity-90 transition-opacity"
            aria-label="Opportunity Verifier Home"
          >
            <span className="w-7 h-7 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] flex items-center justify-center">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Verifier</span>
          </Link>

          {/* Operational Status Dot (keeps test & trust requirement) */}
          <div className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-[#10b981]/10 text-[#065f46] dark:text-[#34d399] border border-[#10b981]/20">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" aria-hidden="true" />
            <span>OPERATIONAL</span>
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Main Navigation">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-md text-[13.5px] transition-colors ${
                  isActive
                    ? "font-semibold text-[#0A0A0A] dark:text-white bg-neutral-100 dark:bg-white/10"
                    : "text-neutral-600 dark:text-neutral-400 hover:text-[#0A0A0A] dark:hover:text-white hover:bg-neutral-50 dark:hover:bg-white/5"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Desktop Actions */}
        <div className="hidden md:flex items-center gap-2">
          {/* Language Toggle */}
          <button
            type="button"
            onClick={toggleLanguage}
            className="h-8 px-2.5 rounded-md border border-[#E5E7EB] dark:border-white/10 text-xs font-mono font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
            title="Toggle language / भाषा बदलें"
            aria-label="Toggle Language"
          >
            {lang === "en" ? "EN" : "हि"}
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="w-8 h-8 rounded-md border border-[#E5E7EB] dark:border-white/10 flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            aria-label="Toggle theme"
          >
            {mounted && theme === "dark" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* Primary CTA button */}
          <Link
            href="/check"
            className="ml-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] text-xs font-semibold hover:opacity-90 active:scale-[0.98] transition-all shadow-xs"
          >
            <span>Check an offer</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>

        {/* Mobile Menu Hamburger */}
        <div className="flex md:hidden items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="w-9 h-9 rounded-md border border-[#E5E7EB] dark:border-white/10 flex items-center justify-center text-neutral-600 dark:text-neutral-300"
            aria-label="Toggle theme"
          >
            {mounted && theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="w-9 h-9 rounded-md border border-[#E5E7EB] dark:border-white/10 flex items-center justify-center text-neutral-800 dark:text-neutral-200"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Slide-Over Drawer / Sheet */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 top-14 z-50 md:hidden flex flex-col">
          {/* Backdrop */}
          <div
            className="fixed inset-0 top-14 bg-black/40 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer content */}
          <div className="relative bg-white dark:bg-[#0A0A0C] border-b border-[#E5E7EB] dark:border-white/10 px-5 py-6 shadow-xl flex flex-col gap-4">
            <nav className="flex flex-col gap-1" aria-label="Mobile Navigation">
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`min-h-[44px] px-3.5 flex items-center rounded-md text-[15px] transition-colors ${
                      isActive
                        ? "font-semibold text-[#0A0A0A] dark:text-white bg-neutral-100 dark:bg-white/10"
                        : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="pt-3 border-t border-[#E5E7EB] dark:border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={toggleLanguage}
                className="min-h-[44px] px-3.5 rounded-md border border-[#E5E7EB] dark:border-white/10 text-xs font-mono font-medium flex items-center gap-2 text-neutral-700 dark:text-neutral-300"
              >
                <span>Language:</span>
                <span className="font-bold">{lang === "en" ? "English" : "हिंदी"}</span>
              </button>

              <Link
                href="/check"
                className="min-h-[44px] px-4 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] text-sm font-semibold flex items-center gap-2 shadow-xs"
              >
                <span>Check an offer</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

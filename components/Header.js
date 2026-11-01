"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link.js";
import { usePathname } from "next/navigation.js";
import { useAuth } from "./AuthContext.js";
import AccountDeletionModal from "./AccountDeletionModal.js";

export default function Header() {
  const pathname = usePathname();
  const { user, authConfigured, logout, deleteAccount } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const [theme, setTheme] = useState("light");
  const [mounted, setMounted] = useState(false);
  const dropdownRef = useRef(null);

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

  // Close menus on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setProfileMenuOpen(false);
  }, [pathname]);

  // Close profile dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    }
    if (profileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileMenuOpen]);

  // Close drawers/menus on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
        setProfileMenuOpen(false);
      }
    }
    if (mobileMenuOpen || profileMenuOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen, profileMenuOpen]);

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

  const returnTo = pathname ? encodeURIComponent(pathname) : "%2F";
  const loginUrl = `/auth/google?returnTo=${returnTo}`;

  return (
    <>
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

            {/* Operational Status Dot */}
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

            {/* Google OAuth Section */}
            {user ? (
              /* Signed-in profile avatar + dropdown */
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className="flex items-center gap-1.5 p-0.5 rounded-full border border-neutral-300 dark:border-white/20 hover:border-neutral-400 dark:hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition-all"
                  aria-expanded={profileMenuOpen}
                  aria-label="User profile menu"
                >
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.name || "User avatar"}
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-full object-cover"
                    />
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-xs flex items-center justify-center">
                      {(user.name || user.email || "U").charAt(0).toUpperCase()}
                    </span>
                  )}
                </button>

                {profileMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-64 rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-[#121215] shadow-xl p-2 z-50 flex flex-col gap-1 text-sm animate-in fade-in zoom-in-95 duration-100"
                  >
                    <div className="px-3 py-2 border-b border-neutral-100 dark:border-white/5">
                      <div className="font-semibold text-neutral-900 dark:text-white truncate">
                        {user.name}
                      </div>
                      <div className="text-xs text-neutral-500 font-mono truncate mt-0.5">
                        {user.email}
                      </div>
                    </div>

                    <Link
                      href="/history"
                      role="menuitem"
                      onClick={() => setProfileMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>Your checks</span>
                    </Link>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setDeleteModalOpen(true);
                      }}
                      className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                      <span>Delete account & data</span>
                    </button>

                    <div className="border-t border-neutral-100 dark:border-white/5 my-0.5" />

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => logout()}
                      className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors font-medium"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      <span>Sign out</span>
                    </button>
                  </div>
                )}
              </div>
            ) : authConfigured ? (
              /* Google Sign-in Button */
              <Link
                href={loginUrl}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-white/15 bg-white dark:bg-white/5 text-neutral-800 dark:text-neutral-100 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-white/10 active:scale-[0.98] transition-all shadow-xs"
              >
                <svg width="14" height="14" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Sign in</span>
              </Link>
            ) : (
              /* Sign-in not configured fallback badge */
              <span
                className="inline-flex items-center px-2 py-1 rounded text-[11px] font-mono text-neutral-400 border border-dashed border-neutral-300 dark:border-white/10 cursor-help"
                title="Google OAuth environment variables are not configured"
              >
                Sign-in is not configured
              </span>
            )}

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
            {user && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="p-0.5 rounded-full border border-neutral-300 dark:border-white/20"
                aria-label="User profile"
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full object-cover"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-xs flex items-center justify-center">
                    {(user.name || user.email || "U").charAt(0).toUpperCase()}
                  </span>
                )}
              </button>
            )}

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
              {/* User profile section if signed in */}
              {user ? (
                <div className="p-3 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 flex flex-col gap-2">
                  <div className="flex items-center gap-2.5">
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.name}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover"
                      />
                    ) : (
                      <span className="w-9 h-9 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold text-sm flex items-center justify-center">
                        {(user.name || user.email || "U").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-neutral-900 dark:text-white truncate">
                        {user.name}
                      </div>
                      <div className="text-xs text-neutral-500 font-mono truncate">
                        {user.email}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-neutral-200 dark:border-white/10">
                    <button
                      type="button"
                      onClick={() => logout()}
                      className="text-xs text-neutral-700 dark:text-neutral-300 font-medium px-2 py-1 rounded hover:bg-neutral-200 dark:hover:bg-white/10"
                    >
                      Sign out
                    </button>
                    <span className="text-neutral-300 dark:text-white/20">|</span>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setDeleteModalOpen(true);
                      }}
                      className="text-xs text-red-600 dark:text-red-400 font-medium px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20"
                    >
                      Delete account
                    </button>
                  </div>
                </div>
              ) : authConfigured ? (
                <Link
                  href={loginUrl}
                  onClick={() => setMobileMenuOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-neutral-300 dark:border-white/15 bg-white dark:bg-white/5 text-neutral-800 dark:text-neutral-100 text-sm font-semibold flex items-center justify-center gap-2.5 shadow-xs"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  <span>Continue with Google</span>
                </Link>
              ) : (
                <div className="p-2.5 rounded-lg border border-dashed border-neutral-300 dark:border-white/10 text-xs text-neutral-400 text-center font-mono">
                  Sign-in is not configured
                </div>
              )}

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

      {/* Account Deletion Confirmation Modal */}
      <AccountDeletionModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={deleteAccount}
      />
    </>
  );
}

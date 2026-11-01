"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation.js";

const ERROR_MESSAGES = {
  auth_not_configured: "Google sign-in is not configured on this server.",
  missing_code: "Sign-in could not be completed: authorization code was missing.",
  missing_state_cookie: "Sign-in session expired or was blocked by cookie settings.",
  state_mismatch: "Security validation failed. Please try signing in again.",
  unverified_email: "Your Google account email must be verified to sign in.",
  oauth_access_denied: "Google sign-in was canceled.",
  oauth_token_exchange_failed: "Failed to verify credentials with Google.",
  oauth_failed: "Google sign-in failed. Please try again.",
  rate_limited: "Too many sign-in attempts. Please wait a few minutes.",
  oauth_init_failed: "Could not initiate Google sign-in. Please try again.",
};

function ToastContent() {
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    const errorKey = searchParams?.get("auth_error");
    if (!errorKey) return;

    const message = ERROR_MESSAGES[errorKey] || "Authentication failed. Please try again.";
    setErrorMessage(message);

    // Clean URL without reloading page
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("auth_error");
      window.history.replaceState({}, "", url.pathname + url.search);
    } catch {}

    const timer = setTimeout(() => {
      setErrorMessage(null);
    }, 8000);

    return () => clearTimeout(timer);
  }, [searchParams]);

  if (!errorMessage) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-5 right-5 z-50 max-w-md w-[calc(100vw-2.5rem)] p-4 rounded-xl shadow-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/90 text-red-900 dark:text-red-200 backdrop-blur-md flex items-start gap-3 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="w-5 h-5 mt-0.5 shrink-0 text-red-600 dark:text-red-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="flex-1 text-sm leading-snug font-medium">
        {errorMessage}
      </div>
      <button
        type="button"
        onClick={() => setErrorMessage(null)}
        className="shrink-0 p-1 rounded-md text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
        aria-label="Dismiss message"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default function AuthErrorToast() {
  return (
    <Suspense fallback={null}>
      <ToastContent />
    </Suspense>
  );
}

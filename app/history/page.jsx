"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link.js";
import Card from "../../components/ui/Card.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/ui/Button.jsx";
import { useAuth } from "../../components/AuthContext.js";

const STORAGE_KEYS = ["ov_recent_checks", "aegis_recent_checks"];
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export default function HistoryPage() {
  const { user, authConfigured } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [checks, setChecks] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Load checks: merges server history (if signed in) with local storage
  useEffect(() => {
    let isMounted = true;

    async function loadAll() {
      let localItems = [];
      try {
        for (const key of STORAGE_KEYS) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              localItems = [...localItems, ...parsed];
            }
          }
        }
      } catch {}

      let serverItems = [];
      if (user) {
        try {
          const res = await fetch("/api/me/checks");
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.checks)) {
              serverItems = data.checks.map((c) => ({
                id: c.id,
                text: "Verification Check",
                timestamp: new Date(c.createdAt).getTime(),
                riskLevel: c.riskLevel || "unknown",
                score: c.score ?? null,
                fromServer: true,
              }));
            }
          }
        } catch {}
      }

      // Merge: server items first, then local items if not already present
      const seen = new Set();
      const unique = [];

      for (const item of [...serverItems, ...localItems]) {
        if (item && item.id && !seen.has(item.id)) {
          seen.add(item.id);
          const ts = item.createdAt
            ? new Date(item.createdAt).getTime()
            : item.timestamp || Date.now();
          unique.push({
            id: item.id,
            text: item.text || "Verification Check",
            timestamp: ts,
            riskLevel: item.riskLevel || "unknown",
            score: item.score ?? null,
            fromServer: Boolean(item.fromServer),
          });
        }
      }

      unique.sort((a, b) => b.timestamp - a.timestamp);

      if (isMounted) {
        setChecks(unique);
        setLoaded(true);
      }
    }

    loadAll();
    return () => {
      isMounted = false;
    };
  }, [user]);

  const counts = useMemo(() => {
    const c = { all: checks.length, high: 0, medium: 0, low: 0, cannot_verify: 0, expired: 0 };
    checks.forEach((item) => {
      const isExpired = Date.now() - item.timestamp > TTL_MS;
      if (isExpired) c.expired++;
      const r = (item.riskLevel || "").toLowerCase();
      if (r === "high") c.high++;
      else if (r === "medium") c.medium++;
      else if (r === "low") c.low++;
      else c.cannot_verify++;
    });
    return c;
  }, [checks]);

  const filteredChecks = useMemo(() => {
    return checks.filter((c) => {
      const isExpired = Date.now() - c.timestamp > TTL_MS;
      const r = (c.riskLevel || "").toLowerCase();

      if (activeFilter === "high" && r !== "high") return false;
      if (activeFilter === "medium" && r !== "medium") return false;
      if (activeFilter === "low" && r !== "low") return false;
      if (activeFilter === "cannot_verify" && r !== "cannot_verify" && r !== "unknown") return false;
      if (activeFilter === "expired" && !isExpired) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesText = c.text.toLowerCase().includes(q);
        const matchesId = c.id.toLowerCase().includes(q);
        return matchesText || matchesId;
      }

      return true;
    });
  }, [checks, activeFilter, searchQuery]);

  function clearHistory() {
    if (!window.confirm("Clear all local verification history from this browser?")) return;
    for (const key of STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
    // If signed in, keep server checks
    setChecks((prev) => prev.filter((c) => c.fromServer));
  }

  function clearExpired() {
    const remaining = checks.filter((c) => Date.now() - c.timestamp <= TTL_MS);
    for (const key of STORAGE_KEYS) {
      localStorage.setItem(key, JSON.stringify(remaining.filter((c) => !c.fromServer)));
    }
    setChecks(remaining);
  }

  function exportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(checks, null, 2));
    const dl = document.createElement("a");
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `verification_history_${new Date().toISOString().slice(0, 10)}.json`);
    dl.click();
  }

  const filterTabs = [
    { id: "all", label: "All", count: counts.all },
    { id: "high", label: "High Risk", count: counts.high },
    { id: "medium", label: "Medium Risk", count: counts.medium },
    { id: "low", label: "Low Risk", count: counts.low },
    { id: "cannot_verify", label: "Cannot Verify", count: counts.cannot_verify },
    { id: "expired", label: "Expired", count: counts.expired },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0A0A0A] dark:text-white">
            Verification history
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {user ? (
              <span>Signed in as <strong className="text-neutral-900 dark:text-neutral-200">{user.email}</strong>. Records expire after 24 hours.</span>
            ) : (
              <span>Stored locally on this device only. Server records expire after 24 hours.</span>
            )}
          </p>
        </div>

        {checks.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportJSON}>
              Export JSON
            </Button>
            {counts.expired > 0 && (
              <Button variant="ghost" size="sm" onClick={clearExpired}>
                Clear expired
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={clearHistory}>
              Clear local
            </Button>
          </div>
        )}
      </div>

      {/* Sync banner for signed-out users */}
      {!user && authConfigured && (
        <div className="mb-6 p-4 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50/70 dark:bg-white/[0.03] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white dark:bg-white/10 border border-neutral-200 dark:border-white/10 flex items-center justify-center shrink-0">
              <svg width="15" height="15" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-900 dark:text-white">
                Sync checks across devices
              </p>
              <p className="text-xs text-neutral-500">
                Sign in with Google to access your verification history on any browser.
              </p>
            </div>
          </div>
          <Link
            href="/auth/google?returnTo=%2Fhistory"
            className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-white/20 bg-white dark:bg-white/10 text-xs font-medium text-neutral-800 dark:text-white hover:bg-neutral-100 dark:hover:bg-white/15 transition-all shrink-0"
          >
            Sign in with Google
          </Link>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col gap-4 mb-6">
        <input
          type="text"
          placeholder="Search by keywords or check ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full min-h-[44px] sm:min-h-[38px] px-3.5 text-sm rounded-lg border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#121215] text-[#0A0A0A] dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] dark:focus:ring-white transition-colors"
        />

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFilter(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                activeFilter === tab.id
                  ? "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A]"
                  : "bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-white/15"
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] font-mono px-1 rounded ${activeFilter === tab.id ? "bg-white/20 dark:bg-black/20" : "bg-neutral-200 dark:bg-white/10"}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {!loaded ? (
        <div className="p-12 text-center text-sm text-neutral-400">Loading history...</div>
      ) : filteredChecks.length === 0 ? (
        <Card className="p-12 text-center flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-white/10 flex items-center justify-center text-neutral-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[#0A0A0A] dark:text-white">
            {checks.length === 0 ? "No verification history yet" : "No matching checks found"}
          </h2>
          <p className="text-xs text-neutral-500 max-w-sm">
            {checks.length === 0
              ? "Checks run on this device or while signed in will appear here for 24 hours."
              : "Try adjusting your search terms or filter selection."}
          </p>
          {checks.length === 0 && (
            <Link href="/check">
              <Button variant="primary" size="sm" className="mt-2">
                Check your first offer
              </Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredChecks.map((item) => {
            const isExpired = Date.now() - item.timestamp > TTL_MS;
            return (
              <Link key={item.id} href={`/check/${item.id}`} className="block group">
                <Card hover className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-neutral-400 uppercase">
                        #{item.id.slice(0, 8)}
                      </span>
                      {isExpired && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                          Expired
                        </span>
                      )}
                      {item.fromServer && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/40">
                          Account
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-[#0A0A0A] dark:text-white truncate">
                      {item.text}
                    </p>
                    <span className="text-xs text-neutral-400 font-mono">
                      {new Date(item.timestamp).toLocaleDateString()} at {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant={item.riskLevel}>
                      {item.riskLevel.replace(/_/g, " ")}
                    </Badge>
                    <svg className="w-4 h-4 text-neutral-400 group-hover:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

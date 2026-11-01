"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Card from "../../components/ui/Card.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/ui/Button.jsx";

const STORAGE_KEYS = ["ov_recent_checks", "aegis_recent_checks"];
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export default function HistoryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [checks, setChecks] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Load checks from client-side localStorage
  useEffect(() => {
    try {
      let combined = [];
      for (const key of STORAGE_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            combined = [...combined, ...parsed];
          }
        }
      }

      // Deduplicate by id
      const seen = new Set();
      const unique = [];
      for (const item of combined) {
        if (item && item.id && !seen.has(item.id)) {
          seen.add(item.id);
          const ts = item.createdAt ? new Date(item.createdAt).getTime() : item.timestamp || Date.now();
          unique.push({
            id: item.id,
            text: item.text || "Verification Check",
            timestamp: ts,
            riskLevel: item.riskLevel || "unknown",
            score: item.score ?? null,
          });
        }
      }

      unique.sort((a, b) => b.timestamp - a.timestamp);
      setChecks(unique);
    } catch {
      setChecks([]);
    } finally {
      setLoaded(true);
    }
  }, []);

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
    setChecks([]);
  }

  function clearExpired() {
    const remaining = checks.filter((c) => Date.now() - c.timestamp <= TTL_MS);
    for (const key of STORAGE_KEYS) {
      localStorage.setItem(key, JSON.stringify(remaining));
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0A0A0A] dark:text-white">
            Verification history
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Stored locally on this device only. Server records expire after 24 hours.
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
              Clear all
            </Button>
          </div>
        )}
      </div>

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
              ? "Checks run on this device will appear here for 24 hours."
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

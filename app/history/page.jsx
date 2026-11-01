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
  const [runs, setRuns] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadAll() {
      let historyItems = [];
      try {
        const res = await fetch("/api/history");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            historyItems = data.map((r) => {
              const inputText = typeof r.input === "string"
                ? r.input
                : (r.input?.text || r.input?.raw || "Verification Run");
              return {
                id: r.id,
                text: inputText.slice(0, 140),
                timestamp: new Date(r.date).getTime(),
                riskLevel: r.verdict || "unknown",
                score: r.score !== undefined ? r.score : "Unavailable",
                fromApi: true,
              };
            });
          }
        }
      } catch {}

      // Also check local storage for offline or client-cached checks
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

      const seen = new Set();
      const combined = [];

      for (const item of [...historyItems, ...localItems]) {
        if (item && item.id && !seen.has(item.id)) {
          seen.add(item.id);
          const ts = item.timestamp || (item.date ? new Date(item.date).getTime() : Date.now());
          combined.push({
            id: item.id,
            text: item.text || "Verification Check",
            timestamp: ts,
            riskLevel: (item.riskLevel || item.verdict || "unknown").toLowerCase(),
            score: item.score !== undefined && item.score !== null ? item.score : "Unavailable",
            fromApi: Boolean(item.fromApi),
          });
        }
      }

      combined.sort((a, b) => b.timestamp - a.timestamp);

      if (isMounted) {
        setRuns(combined);
        setLoaded(true);
      }
    }

    loadAll();
    return () => {
      isMounted = false;
    };
  }, [user]);

  const counts = useMemo(() => {
    const c = { all: runs.length, high: 0, medium: 0, low: 0, cannot_verify: 0, expired: 0 };
    runs.forEach((item) => {
      const isExpired = Date.now() - item.timestamp > TTL_MS;
      if (isExpired) c.expired++;
      const r = (item.riskLevel || "").toLowerCase();
      if (r === "high") c.high++;
      else if (r === "medium") c.medium++;
      else if (r === "low") c.low++;
      else c.cannot_verify++;
    });
    return c;
  }, [runs]);

  const filteredRuns = useMemo(() => {
    return runs.filter((c) => {
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
  }, [runs, activeFilter, searchQuery]);

  function exportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(runs, null, 2));
    const dl = document.createElement("a");
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `verification_history_${new Date().toISOString().slice(0, 10)}.json`);
    dl.click();
  }

  const filterTabs = [
    { id: "all", label: "All Runs", count: counts.all },
    { id: "high", label: "High Risk", count: counts.high },
    { id: "medium", label: "Medium Risk", count: counts.medium },
    { id: "low", label: "Low Risk", count: counts.low },
    { id: "cannot_verify", label: "Cannot Verify", count: counts.cannot_verify },
    { id: "expired", label: "Expired", count: counts.expired },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 md:py-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 border-b border-neutral-200 dark:border-neutral-800 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Run History
          </h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Complete verification execution records and per-agent logs. Records persist for 24 hours.
          </p>
        </div>

        {runs.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportJSON}>
              Export JSON
            </Button>
            <Link href="/check">
              <Button variant="primary" size="sm">
                New Check
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-4 mb-6">
        <input
          type="text"
          placeholder="Filter runs by input text or Run ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full min-h-[44px] px-3.5 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-800 dark:focus:ring-neutral-200 transition-colors font-sans"
        />

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFilter(tab.id)}
              className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-2 border ${
                activeFilter === tab.id
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-neutral-900 dark:border-neutral-100"
                  : "bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              <span>{tab.label}</span>
              <span className="text-[10px] font-mono opacity-80">
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Run List */}
      {!loaded ? (
        <div className="p-16 text-center text-sm text-neutral-400 font-mono">
          Loading run history...
        </div>
      ) : filteredRuns.length === 0 ? (
        <Card className="p-12 text-center flex flex-col items-center gap-3 border border-dashed border-neutral-300 dark:border-neutral-700">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {runs.length === 0 ? "No verification runs recorded yet" : "No matching runs found"}
          </h2>
          <p className="text-xs text-neutral-500 max-w-sm">
            {runs.length === 0
              ? "When you verify suspicious scholarships, jobs, or opportunities, each execution and agent log is archived here."
              : "Try adjusting your search query or filter selection."}
          </p>
          {runs.length === 0 && (
            <Link href="/check">
              <Button variant="primary" size="sm" className="mt-2">
                Submit Opportunity to Verify
              </Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRuns.map((item) => {
            const isExpired = Date.now() - item.timestamp > TTL_MS;
            const scoreDisplay = typeof item.score === "number"
              ? `${item.score}/100`
              : (item.score || "Unavailable");

            return (
              <div
                key={item.id}
                className="p-4 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-medium text-neutral-500 dark:text-neutral-400">
                      ID: {item.id}
                    </span>
                    {isExpired && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-500">
                        EXPIRED
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 line-clamp-1">
                    {item.text}
                  </p>

                  <div className="flex items-center gap-3 text-xs text-neutral-500 font-mono">
                    <span>{new Date(item.timestamp).toLocaleDateString()} {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>•</span>
                    <span>Score: <strong className="text-neutral-800 dark:text-neutral-200">{scoreDisplay}</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <Badge variant={item.riskLevel}>
                    {item.riskLevel.toUpperCase().replace(/_/g, " ")}
                  </Badge>
                  <Link
                    href={`/history/${item.id}`}
                    className="inline-flex items-center justify-center px-3 py-1.5 rounded border border-neutral-300 dark:border-neutral-700 text-xs font-medium text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    View Agent Logs
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

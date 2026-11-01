"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Card from "../../components/ui/Card.jsx";
import Badge from "../../components/ui/Badge.jsx";
import { GUIDES_CONTENT } from "../../lib/guides/content.js";

const CATEGORY_MAP = {
  scholarship_scam: "Scholarships",
  internship_scam: "Internships",
  task_scam: "Tasks",
  mule_account_scam: "Mule Accounts",
  competition_scam: "Competitions",
  overseas_offer_scam: "Overseas",
};

export default function GuidesIndexPage() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const categories = [
    { id: "all", label: "All Guides" },
    { id: "Scholarships", label: "Scholarships" },
    { id: "Internships", label: "Internships" },
    { id: "Tasks", label: "Tasks" },
    { id: "Mule Accounts", label: "Mule Accounts" },
    { id: "Competitions", label: "Competitions" },
    { id: "Overseas", label: "Overseas" },
  ];

  const filteredGuides = useMemo(() => {
    return GUIDES_CONTENT.filter((g) => {
      const cat = CATEGORY_MAP[g.type] || "Other";
      if (selectedCategory !== "all" && cat !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          g.title.toLowerCase().includes(q) ||
          g.summary.toLowerCase().includes(q) ||
          g.redFlags.some((rf) => rf.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [selectedCategory, searchQuery]);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0A0A0A] dark:text-white">
            Scam awareness guides
          </h1>
          <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
            Learn common opportunity fraud tactics, red flags, and verification protocols.
          </p>
        </div>

        <Link
          href="/check"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] text-xs font-semibold hover:opacity-90 active:scale-[0.98] transition-all shrink-0 shadow-xs"
        >
          <span>Verify an offer</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      </div>

      {/* Search & Category Filter Pills */}
      <div className="flex flex-col gap-3.5 mb-8">
        <input
          type="text"
          placeholder="Search by keywords, scam type, or red flags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full min-h-[44px] sm:min-h-[38px] px-3.5 text-sm rounded-lg border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#121215] text-[#0A0A0A] dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] dark:focus:ring-white transition-colors"
        />

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat.id
                  ? "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A]"
                  : "bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-white/15"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Guides Grid */}
      {filteredGuides.length === 0 ? (
        <Card className="p-12 text-center text-sm text-neutral-500">
          No guides match your search query. Try another term.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredGuides.map((guide) => (
            <Link key={guide.type} href={`/guides/${guide.type}`} className="group block h-full">
              <Card hover className="p-5 h-full flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-neutral-400 uppercase tracking-wide">
                      {CATEGORY_MAP[guide.type] || "Guide"}
                    </span>
                    <Badge variant="neutral">
                      {guide.redFlags?.length || 0} Red Flags
                    </Badge>
                  </div>
                  <h2 className="text-base font-semibold text-[#0A0A0A] dark:text-white group-hover:text-neutral-700 dark:group-hover:text-neutral-200 transition-colors">
                    {guide.title}
                  </h2>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-3 leading-relaxed">
                    {guide.summary}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#E5E7EB] dark:border-white/5 text-xs text-neutral-900 dark:text-white font-medium">
                  <span>Read full breakdown</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="group-hover:translate-x-0.5 transition-transform">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

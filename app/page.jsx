"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Card from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";

const COMMON_SCAMS = [
  {
    type: "internship_scam",
    title: "Fake Internship Offers",
    desc: "Offer letters sent via WhatsApp demanding upfront training or equipment security deposits.",
    badge: "Most Common",
  },
  {
    type: "scholarship_scam",
    title: "Scholarship Processing Fees",
    desc: "Notifications claiming award selection contingent on an administrative or verification charge.",
    badge: "High Risk",
  },
  {
    type: "task_scam",
    title: "Telegram Part-Time Tasks",
    desc: "Daily payout schemes for reviewing videos or rating apps that pivot into deposit traps.",
    badge: "High Risk",
  },
  {
    type: "mule_account_scam",
    title: "Student Account Rental",
    desc: "Solicitations paying students to route commission payments through their private bank accounts.",
    badge: "Severe",
  },
  {
    type: "competition_scam",
    title: "Pay-to-Enter Competitions",
    desc: "Hackathons and conferences charging non-refundable fees without verifiable corporate sponsors.",
    badge: "Moderate",
  },
  {
    type: "overseas_offer_scam",
    title: "Overseas Research Traineeships",
    desc: "Unsolicited overseas trainee offers requiring visa clearance fees to personal remittance accounts.",
    badge: "High Risk",
  },
];

export default function HomePage() {
  const [recentChecks, setRecentChecks] = useState([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem("ov_recent_checks");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setRecentChecks(parsed.slice(0, 3));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="w-full flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full max-w-4xl px-4 sm:px-6 pt-12 sm:pt-20 pb-12 sm:pb-16 text-center flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-medium bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 mb-6 border border-[#E5E7EB] dark:border-white/10">
          <span>Student Opportunity Verifier</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-[#0A0A0A] dark:text-white max-w-2xl leading-[1.15]">
          Verify any student offer before you pay or share data.
        </h1>

        <p className="mt-4 sm:mt-6 text-base sm:text-lg text-neutral-600 dark:text-neutral-400 max-w-xl leading-relaxed">
          Autonomous multi-agent verification checking company records, domain age, payment IDs, and scam databases before you commit.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
          <Link
            href="/check"
            className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-lg bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] font-semibold text-sm inline-flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
          >
            <span>Check an offer</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>

          <Link
            href="/guides"
            className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-white/15 bg-white dark:bg-transparent text-neutral-800 dark:text-neutral-200 font-medium text-sm inline-flex items-center justify-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
          >
            <span>Explore scam guides</span>
          </Link>
        </div>
      </section>

      {/* How It Works */}
      <section className="w-full border-y border-[#E5E7EB] dark:border-white/10 bg-neutral-50/60 dark:bg-white/[0.02] py-14 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0A0A0A] dark:text-white">
              How verification works
            </h2>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              Deterministic verification combining public records and AI-assisted analysis.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6 flex flex-col gap-3">
              <span className="w-8 h-8 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] font-mono text-xs font-bold flex items-center justify-center">
                01
              </span>
              <h3 className="text-base font-semibold text-[#0A0A0A] dark:text-white">
                Submit details
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Paste the offer text, email body, UPI ID, or upload screenshots of chat conversations.
              </p>
            </Card>

            <Card className="p-6 flex flex-col gap-3">
              <span className="w-8 h-8 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] font-mono text-xs font-bold flex items-center justify-center">
                02
              </span>
              <h3 className="text-base font-semibold text-[#0A0A0A] dark:text-white">
                6 specialist agents
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Agents cross-reference Ministry of Corporate Affairs records, domain registration date, and payment history.
              </p>
            </Card>

            <Card className="p-6 flex flex-col gap-3">
              <span className="w-8 h-8 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] font-mono text-xs font-bold flex items-center justify-center">
                03
              </span>
              <h3 className="text-base font-semibold text-[#0A0A0A] dark:text-white">
                Evidence report
              </h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Receive an evidence-backed risk level (Low, Medium, High, or Cannot Verify) and actionable next steps.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Common Scam Archetypes */}
      <section className="w-full max-w-4xl px-4 sm:px-6 py-14 sm:py-20">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0A0A0A] dark:text-white">
              Common scam playbooks
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Familiarize yourself with red flags and preventative steps.
            </p>
          </div>
          <Link
            href="/guides"
            className="text-xs font-semibold text-neutral-900 dark:text-white hover:underline flex items-center gap-1 shrink-0"
          >
            <span>View all 6 playbooks</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {COMMON_SCAMS.map((scam) => (
            <Link key={scam.type} href={`/guides/${scam.type}`} className="group">
              <Card hover className="p-5 h-full flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500">
                      PLAYBOOK
                    </span>
                    <Badge variant={scam.badge === "Severe" || scam.badge === "High Risk" ? "high" : "neutral"}>
                      {scam.badge}
                    </Badge>
                  </div>
                  <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white group-hover:text-neutral-700 dark:group-hover:text-neutral-200 transition-colors">
                    {scam.title}
                  </h3>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2 leading-relaxed">
                    {scam.desc}
                  </p>
                </div>
                <div className="text-xs font-medium text-neutral-900 dark:text-white flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  <span>Read red flags</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent Checks on this device */}
      {mounted && recentChecks.length > 0 && (
        <section className="w-full border-t border-[#E5E7EB] dark:border-white/10 bg-neutral-50/50 dark:bg-white/[0.01] py-12">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
                Recent checks on this device
              </h2>
              <Link href="/history" className="text-xs text-neutral-500 hover:text-black dark:hover:text-white underline">
                View all in history
              </Link>
            </div>
            <div className="space-y-2">
              {recentChecks.map((item) => (
                <Link key={item.id} href={`/check/${item.id}`} className="block">
                  <Card hover className="p-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0 bg-[#0A0A0A] dark:bg-white" />
                      <p className="text-xs font-medium text-[#0A0A0A] dark:text-white truncate">
                        {item.text || `Check #${item.id.slice(0, 8)}`}
                      </p>
                    </div>
                    <Badge variant={item.riskLevel || "neutral"}>
                      {(item.riskLevel || "pending").replace(/_/g, " ")}
                    </Badge>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

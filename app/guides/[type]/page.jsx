import React from "react";
import { notFound } from "next/navigation.js";
import Link from "next/link.js";
import { getGuideByType, listGuides } from "../../../lib/guides/index.js";
import Card from "../../../components/ui/Card.js";

export const dynamic = "force-static";

export function generateStaticParams() {
  return listGuides().map((g) => ({ type: g.type }));
}

export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const guide = getGuideByType(resolvedParams?.type);

  if (!guide) {
    return {
      title: "Guide Not Found",
      description: "The requested opportunity fraud guide was not found.",
    };
  }

  return {
    title: `${guide.title} — Scam Awareness Guide`,
    description: guide.summary,
    openGraph: {
      title: `${guide.title} — Student Opportunity Verifier`,
      description: guide.summary,
      type: "article",
    },
  };
}

export default async function GuideDetailPage({ params }) {
  const resolvedParams = await params;
  const guide = getGuideByType(resolvedParams?.type);

  if (!guide) {
    notFound();
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 md:py-12">
      {/* Top Breadcrumbs */}
      <div className="flex items-center justify-between text-xs font-mono text-neutral-500 mb-6 pb-3 border-b border-[#E5E7EB] dark:border-white/10">
        <Link
          href="/guides"
          className="text-neutral-600 dark:text-neutral-400 hover:text-[#0A0A0A] dark:hover:text-white flex items-center gap-1.5 transition-colors"
        >
          <span>←</span>
          <span>All guides</span>
        </Link>
        <span className="uppercase text-[11px]">
          {guide.type.replace(/_/g, " ")}
        </span>
      </div>

      {/* Header */}
      <header className="mb-10 space-y-3">
        <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-[#0A0A0A] dark:text-white leading-tight">
          {guide.title}
        </h1>

        <p className="text-base text-neutral-600 dark:text-neutral-300 leading-relaxed">
          {guide.summary}
        </p>
      </header>

      <div className="flex flex-col gap-10">
        {/* How It Operates */}
        {guide.howItWorks && guide.howItWorks.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-[#0A0A0A] dark:text-white">
              How this scheme operates
            </h2>
            <div className="space-y-2.5">
              {guide.howItWorks.map((step, idx) => (
                <Card key={idx} className="p-4 flex items-start gap-3.5">
                  <span className="w-6 h-6 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {(idx + 1).toString().padStart(2, "0")}
                  </span>
                  <p className="text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
                    {step}
                  </p>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Red Flags */}
        {guide.redFlags && guide.redFlags.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-[#0A0A0A] dark:text-white">
              Warning signs &amp; red flags
            </h2>
            <Card className="p-5">
              <ul className="space-y-3">
                {guide.redFlags.map((flag, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 mt-2" />
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {/* What to verify before committing */}
        {guide.whatToVerify && guide.whatToVerify.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-[#0A0A0A] dark:text-white">
              What to check before paying or signing
            </h2>
            <Card className="p-5">
              <ul className="space-y-3">
                {guide.whatToVerify.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-2" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {/* Emergency Steps if Already Paid */}
        {guide.alreadyPaid && guide.alreadyPaid.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-rose-700 dark:text-rose-400">
                Already paid? Immediate emergency steps
              </h2>
              <Link
                href="/report-fraud"
                className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
              >
                <span>Report fraud now</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            </div>
            <Card className="p-5 border-rose-200 dark:border-rose-900/30 bg-rose-50/40 dark:bg-rose-950/20">
              <ul className="space-y-3">
                {guide.alreadyPaid.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
                    <span className="font-mono text-xs text-rose-600 font-bold shrink-0 mt-0.5">
                      {idx + 1}.
                    </span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {/* Bottom CTA to verify a live offer */}
        <div className="p-6 rounded-xl bg-neutral-100/70 dark:bg-white/5 border border-[#E5E7EB] dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-[#0A0A0A] dark:text-white">
              Have a suspicious offer right now?
            </h3>
            <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
              Check text, links, UPI handles, and screenshot evidence in seconds.
            </p>
          </div>
          <Link
            href="/check"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] text-xs font-semibold hover:opacity-90 active:scale-[0.98] transition-all shrink-0 shadow-xs"
          >
            <span>Verify an offer</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link.js";

export default function Footer() {
  return (
    <footer className="w-full border-t border-[#E5E7EB] dark:border-white/10 bg-neutral-50 dark:bg-[#0A0A0C] text-neutral-600 dark:text-neutral-400 py-10 transition-colors" role="contentinfo">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col gap-8">
        {/* Mandatory PRD Disclaimer Banner */}
        <div className="p-4 rounded-lg bg-neutral-100/70 dark:bg-white/5 border border-[#E5E7EB] dark:border-white/10 text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed" role="note">
          <strong className="text-[#0A0A0A] dark:text-white font-semibold">Risk Assessment Disclaimer: </strong>
          Opportunity Verifier performs automated verification against public gazettes, domain intelligence, and scam advisories. It is an educational risk assessment, never a statement that a named person is a scammer or a definitive legal verdict.{" "}
          <em className="font-medium text-[#0A0A0A] dark:text-white">Nothing found is not the same as safe.</em>
        </div>

        {/* Footer Navigation & Metadata */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="font-semibold text-[#0A0A0A] dark:text-white">Verifier</span>
            <Link href="/about" className="hover:text-[#0A0A0A] dark:hover:text-white transition-colors">
              About & Methodology
            </Link>
            <Link href="/guides" className="hover:text-[#0A0A0A] dark:hover:text-white transition-colors">
              Scam Guides
            </Link>
            <Link href="/report-fraud" className="hover:text-[#0A0A0A] dark:hover:text-white transition-colors">
              Emergency Helpline (1930)
            </Link>
          </div>

          <div className="text-neutral-500 dark:text-neutral-500 font-mono text-[11px]">
            <span>DPDP Act 2023 · Ephemeral Data · 24h Check TTL</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

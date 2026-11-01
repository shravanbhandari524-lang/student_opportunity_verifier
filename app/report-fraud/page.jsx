"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Card from "../../components/ui/Card.jsx";
import { Input } from "../../components/ui/Input.jsx";
import Button from "../../components/ui/Button.jsx";
import { getReportFraudErrorMessage } from "./errors.js";

const PAYMENT_METHODS = [
  { value: "", label: "Select payment method (optional)" },
  { value: "upi", label: "UPI (Google Pay, PhonePe, Paytm, BHIM)" },
  { value: "netbanking", label: "Net Banking (IMPS / NEFT / RTGS)" },
  { value: "card", label: "Debit / Credit Card" },
  { value: "wallet", label: "Digital Wallet" },
  { value: "cash", label: "Cash / Direct Deposit" },
  { value: "other", label: "Other / Crypto / Gift Card" },
];

function ReportFraudContent() {
  const searchParams = useSearchParams();
  const initialCheckId = searchParams.get("check") || "";

  const [checkId, setCheckId] = useState(initialCheckId);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [recipientHandle, setRecipientHandle] = useState("");
  const [utrNumber, setUtrNumber] = useState("");
  const [language, setLanguage] = useState("en");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (initialCheckId) {
      setCheckId(initialCheckId);
    }
  }, [initialCheckId]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const payload = {};
    if (amount && !isNaN(Number(amount)) && Number(amount) > 0) {
      payload.amount = Math.floor(Number(amount));
    }
    if (date) {
      payload.date = date;
    }
    if (paymentMethod) {
      payload.paymentMethod = paymentMethod;
    }
    payload.language = language;

    const endpoint = checkId
      ? `/api/checks/${encodeURIComponent(checkId)}/fraud-summary`
      : `/api/fraud-summary`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(getReportFraudErrorMessage({ status: res.status, code: data.code, message: data.message }));
        return;
      }

      setResult(data);
    } catch {
      setError("Network error connecting to verification service. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.narrative) return;
    try {
      await navigator.clipboard.writeText(result.narrative);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  const handleDownload = () => {
    if (!result?.narrative) return;
    const blob = new Blob([result.narrative], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cybercrime-complaint-${checkId ? checkId.slice(0, 8) : "draft"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-8 md:py-12 flex flex-col gap-8">
      {/* Back Link */}
      <div>
        <Link
          href={checkId ? `/check/${checkId}` : "/check"}
          className="text-xs font-mono text-neutral-500 hover:text-[#0A0A0A] dark:hover:text-white transition-colors flex items-center gap-1.5"
        >
          <span>←</span>
          <span>{checkId ? `Back to report #${checkId.slice(0, 8)}` : "Back to check"}</span>
        </Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0A0A0A] dark:text-white">
          Already paid money?
        </h1>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
          Take immediate action to freeze accounts, preserve evidence, and file official cybercrime reports.
        </p>
      </div>

      {/* Golden Hour Banner */}
      <Card className="p-5 border-amber-300 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Golden Hour Window: Immediate 1930 Helpline Call
            </h2>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Calling within 2 to 4 hours of transaction offers the highest recovery rate through NPCI inter-bank lien freezes.
          </p>
        </div>
        <a
          href="tel:1930"
          className="min-h-[44px] px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center justify-center gap-2 shrink-0 transition-colors shadow-xs"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>Call 1930</span>
        </a>
      </Card>

      {/* Immediate Emergency Protocol */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-[#0A0A0A] dark:text-white">
          Five essential recovery steps
        </h2>

        <div className="space-y-2.5">
          <Card className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                01
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
                  Stop all further payments
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                  Never pay additional &ldquo;clearance fees,&rdquo; &ldquo;refund charges,&rdquo; or taxes demanded by the sender.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40 shrink-0">
              Halt flow
            </span>
          </Card>

          <Card className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                02
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
                  Call your bank or UPI provider immediately
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                  Request an immediate freeze on the transaction reference number (UTR) and dispute the unauthorized charge.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 shrink-0">
              Bank
            </span>
          </Card>

          <Card className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                03
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
                  Call National Cybercrime Helpline 1930
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                  Government of India dedicated emergency financial fraud reporting line operated across all states.
                </p>
              </div>
            </div>
            <a href="tel:1930" className="text-xs text-[#0A0A0A] dark:text-white font-semibold underline shrink-0">
              1930
            </a>
          </Card>

          <Card className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                04
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
                  File an official complaint online
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                  Submit transaction details, UPI handles, and chat exports to the National Cyber Crime Reporting Portal.
                </p>
              </div>
            </div>
            <a
              href="https://cybercrime.gov.in"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#0A0A0A] dark:text-white font-semibold underline shrink-0"
            >
              cybercrime.gov.in
            </a>
          </Card>

          <Card className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                05
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
                  Preserve all chat exports &amp; payment receipts
                </h3>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                  Take full uncropped screenshots of conversation history, recipient profiles, bank SMS alerts, and UPI transaction IDs.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 shrink-0">
              Evidence
            </span>
          </Card>
        </div>
      </section>

      {/* Incident Summary Generator */}
      <section className="space-y-4 pt-4 border-t border-[#E5E7EB] dark:border-white/10" id="summary-generator">
        <div>
          <h2 className="text-base font-bold text-[#0A0A0A] dark:text-white">
            Incident summary generator
          </h2>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
            Generates a structured, neutral complaint statement ready to copy into cybercrime.gov.in or bank disputes.
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Amount Paid (INR)"
              type="number"
              placeholder="e.g. 2500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
            />

            <Input
              label="Date of Payment"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={loading}
            />

            <div className="flex flex-col gap-1.5 w-full">
              <label htmlFor="payment-method" className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                Payment Method
              </label>
              <select
                id="payment-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                disabled={loading}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 text-sm rounded-md border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#121215] text-[#0A0A0A] dark:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] dark:focus:ring-white"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.value} value={pm.value}>
                    {pm.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Recipient Handle / UPI VPA (optional)"
              placeholder="e.g. name@okhdfcbank"
              value={recipientHandle}
              onChange={(e) => setRecipientHandle(e.target.value)}
              disabled={loading}
            />

            <Input
              label="Transaction Ref / UTR Number (optional)"
              placeholder="e.g. UTR-123456789012"
              value={utrNumber}
              onChange={(e) => setUtrNumber(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>Language:</span>
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${language === "en" ? "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A]" : "text-neutral-500"}`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLanguage("hi")}
                className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${language === "hi" ? "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A]" : "text-neutral-500"}`}
              >
                हि
              </button>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={loading}
              disabled={loading}
            >
              Generate complaint summary
            </Button>
          </div>
        </form>

        {/* Generated Summary Card */}
        {result && (
          <Card className="p-5 mt-4 space-y-4 border-[#0A0A0A] dark:border-white/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#0A0A0A] dark:text-white uppercase font-mono">
                Generated Incident Narrative
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  Download .txt
                </Button>
                <Button variant="primary" size="sm" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy narrative"}
                </Button>
              </div>
            </div>

            <pre className="p-4 rounded-lg bg-neutral-50 dark:bg-white/[0.03] border border-[#E5E7EB] dark:border-white/10 text-xs font-mono whitespace-pre-wrap leading-relaxed text-neutral-800 dark:text-neutral-200">
              {result.narrative}
            </pre>
          </Card>
        )}
      </section>
    </div>
  );
}

export default function ReportFraudPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-neutral-400">Loading...</div>}>
      <ReportFraudContent />
    </Suspense>
  );
}

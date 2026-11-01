"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getReportFraudErrorMessage } from "./errors.js";

const PAYMENT_METHODS = [
  { value: "", label: "Select payment method (optional)" },
  { value: "upi", label: "UPI (Google Pay, PhonePe, Paytm, BHIM)" },
  { value: "netbanking", label: "Net Banking (IMPS / NEFT / RTGS)" },
  { value: "card", label: "Debit / Credit Card" },
  { value: "wallet", label: "Digital Wallet" },
  { value: "cash", label: "Cash / Direct Deposit" },
  { value: "other", label: "Other / Cryptocurrency / Gift Card" },
];

function ReportFraudContent() {
  const searchParams = useSearchParams();
  const initialCheckId = searchParams.get("check") || "";

  const [checkId, setCheckId] = useState(initialCheckId);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [language, setLanguage] = useState("en");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (initialCheckId) {
      setCheckId(initialCheckId);
    }
  }, [initialCheckId]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const minDateStr = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    setErrorCode(null);
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
        setErrorCode(data.code || "REQUEST_FAILED");
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
    <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-8">
      {/* Breadcrumb */}
      <div>
        <Link
          href={checkId ? `/check/${checkId}` : "/"}
          className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <span>←</span>
          <span>{checkId ? `Back to Case #${checkId.slice(0, 8)}` : "Back to Home"}</span>
        </Link>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-crimson-500" aria-hidden="true" />
          <span className="font-mono text-xs uppercase text-zinc-500 tracking-wider">
            Victim Incident Response &amp; Legal Draft
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Already Paid or Shared Personal Details?
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
          Immediate, sequential containment steps to minimize financial loss, freeze fraudulent beneficiary accounts, and draft a formal cybercrime complaint.
        </p>
      </div>

      {/* Golden Hour Helpline Banner */}
      <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">🚨</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-900 dark:text-amber-200 text-sm">
                National Cyber Crime Helpline: Dial 1930
              </span>
              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100">
                CRITICAL GOLDEN HOUR
              </span>
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5 leading-relaxed">
              If fraudulent UPI or bank transactions occurred within the last <strong>2 to 4 hours</strong>, call 1930 immediately to intercept and freeze funds before they are siphoned across money mule chains.
            </p>
          </div>
        </div>

        <a
          href="tel:1930"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded shadow-sm whitespace-nowrap transition-colors"
        >
          <span>Call 1930 Now</span>
          <span aria-hidden="true">↗</span>
        </a>
      </div>

      {/* 5-Step Immediate Containment Checklist */}
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Sequential Containment Protocol
        </h2>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md divide-y divide-zinc-200 dark:divide-zinc-800">
          {/* Step 1 */}
          <div className="p-4 flex items-start gap-4">
            <span className="font-mono text-xs font-bold px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-300">
              01
            </span>
            <div>
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 block">
                Stop All Further Transfers (Halt Flow)
              </span>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                Do not send any &ldquo;clearance fees,&rdquo; &ldquo;tax deposits,&rdquo; or &ldquo;unfreezing charges.&rdquo; Scammers routinely demand a second or third payment claiming it will release previous amounts.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-4 flex items-start gap-4">
            <span className="font-mono text-xs font-bold px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-300">
              02
            </span>
            <div>
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 block">
                Notify Bank &amp; Freeze UPI / Netbanking
              </span>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                Call your bank&apos;s 24x7 emergency fraud desk. Request to block your compromised debit card, reset your UPI PIN, and flag the beneficiary transaction reference (UTR) for chargeback / lien marking.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="p-4 flex items-start gap-4">
            <span className="font-mono text-xs font-bold px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-300">
              03
            </span>
            <div>
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 block">
                Preserve Digital Evidence
              </span>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                Do not delete chat transcripts or call records. Export complete WhatsApp/Telegram chat history, take uncropped screenshots of UPI payment receipts showing the 12-digit UTR, and note sender handles.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="p-4 flex items-start gap-4">
            <span className="font-mono text-xs font-bold px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-300">
              04
            </span>
            <div>
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 block">
                Lodge Complaint on National Cyber Crime Portal
              </span>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                File a report at <a href="https://cybercrime.gov.in" target="_blank" rel="noopener noreferrer" className="underline font-mono text-zinc-900 dark:text-zinc-100">cybercrime.gov.in ↗</a> under Financial Fraud. Use the structured complaint narrative generator below.
              </p>
            </div>
          </div>

          {/* Step 5 */}
          <div className="p-4 flex items-start gap-4">
            <span className="font-mono text-xs font-bold px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-700 dark:text-zinc-300">
              05
            </span>
            <div>
              <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 block">
                Report Impersonation via Chakshu (Sanchar Saathi)
              </span>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 leading-relaxed">
                Report the fraudulent mobile number, SMS sender header, or WhatsApp handle on the Department of Telecommunications portal at <a href="https://sancharsaathi.gov.in" target="_blank" rel="noopener noreferrer" className="underline font-mono text-zinc-900 dark:text-zinc-100">sancharsaathi.gov.in ↗</a>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Pre-filled Complaint Summary Generator Form */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md p-5 flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Generate Official Complaint Narrative
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
            Produces an objective, police-ready complaint text structured for the National Cyber Crime Reporting Portal.
          </p>
        </div>

        {checkId && (
          <div className="flex items-center justify-between p-2.5 bg-zinc-50 dark:bg-zinc-800/50 rounded border border-zinc-200 dark:border-zinc-800 text-xs">
            <span className="text-zinc-600 dark:text-zinc-400 font-mono">
              Linked Investigation: <strong>Case #{checkId.slice(0, 8)}</strong>
            </span>
            <button
              type="button"
              onClick={() => setCheckId("")}
              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline"
            >
              Unlink and draft standalone
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="comp-amount" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Defrauded Amount in INR (Optional):
              </label>
              <input
                type="number"
                id="comp-amount"
                min="1"
                placeholder="e.g. 3500"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
              />
            </div>

            <div>
              <label htmlFor="comp-date" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Transaction Date (Optional):
              </label>
              <input
                type="date"
                id="comp-date"
                max={todayStr}
                min={minDateStr}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="comp-method" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Payment Method Used:
              </label>
              <select
                id="comp-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="comp-lang" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Complaint Language:
              </label>
              <select
                id="comp-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100"
              >
                <option value="en">English (Official Standard)</option>
                <option value="hi">Hindi (हिंदी)</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-semibold text-xs rounded shadow-sm disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  <span>Generating Complaint Narrative...</span>
                </>
              ) : (
                <>
                  <span>Generate Complaint Text</span>
                  <span aria-hidden="true">→</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Generated Result Container */}
        {result && (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                {result.title || "Official Complaint Draft"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-3 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-medium text-xs rounded border border-zinc-300 dark:border-zinc-700 transition-colors"
                >
                  {copied ? "✓ Copied" : "📋 Copy Text"}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-3 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-medium text-xs rounded border border-zinc-300 dark:border-zinc-700 transition-colors"
                >
                  ⬇ Download .txt
                </button>
              </div>
            </div>

            <textarea
              readOnly
              rows={10}
              value={result.narrative || ""}
              className="w-full p-3 font-mono text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded text-zinc-900 dark:text-zinc-100 leading-relaxed focus:outline-none resize-none"
            />

            {Array.isArray(result.victimSteps) && result.victimSteps.length > 0 && (
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 rounded text-xs flex flex-col gap-1.5">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Recommended Next Steps from Summary:
                </span>
                <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400 space-y-1">
                  {result.victimSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReportFraudPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto px-4 py-12 text-center text-xs font-mono text-zinc-500">
          Loading fraud assistance workspace...
        </div>
      }
    >
      <ReportFraudContent />
    </Suspense>
  );
}

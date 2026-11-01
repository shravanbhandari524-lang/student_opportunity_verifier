"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import Link from "next/link";
import AgentCards from "../../../components/AgentCards.js";
import AgentActivityDrawer from "../../../components/AgentActivityDrawer.js";
import Checklist from "../../../components/Checklist.js";
import CoverageCard from "../../../components/CoverageCard.js";
import EntitiesEditor from "../../../components/EntitiesEditor.js";
import LinkExtractionCard from "../../../components/LinkExtractionCard.js";
import { CollegeEmailModal, FeedbackModal } from "../../../components/ActionModals.js";
import Card from "../../../components/ui/Card.jsx";
import Button from "../../../components/ui/Button.jsx";
import Badge from "../../../components/ui/Badge.jsx";

export default function CheckDetailPage({ params }) {
  const resolvedParams = params && typeof params.then === "function" ? use(params) : params;
  const checkId = resolvedParams?.id || "";

  const [check, setCheck] = useState(null);
  const [entities, setEntities] = useState([]);
  const [extractedText, setExtractedText] = useState("");
  const [report, setReport] = useState(null);
  const [scoreBreakdown, setScoreBreakdown] = useState(null);
  const [status, setStatus] = useState("loading"); // loading, extracting, awaiting_confirmation, investigating, scoring, report_ready, failed
  const [error, setError] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // Live Progress & Agent Cards
  const [agentsCards, setAgentsCards] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [streamEvents, setStreamEvents] = useState([]);

  // Report & View options
  const [summaryLang, setSummaryLang] = useState("en"); // "en" or "hi"
  const [collegeModalOpen, setCollegeModalOpen] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [copiedChecklist, setCopiedChecklist] = useState(false);

  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  }, [check]);

  // Update local device history
  const updateLocalHistory = useCallback((checkData, reportData) => {
    try {
      const keys = ["aegis_recent_checks", "ov_recent_checks"];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        const list = raw ? JSON.parse(raw) : [];
        const updated = list.map((item) => {
          if (item.id === checkId) {
            return {
              ...item,
              riskLevel: reportData?.riskLevel || checkData?.riskLevel || item.riskLevel || "unknown",
              score: reportData?.score ?? checkData?.score ?? item.score,
            };
          }
          return item;
        });
        localStorage.setItem(k, JSON.stringify(updated));
      }
    } catch {}
  }, [checkId]);

  // Fetch Agent Cards & Activities
  const fetchAgentsCards = useCallback(async () => {
    try {
      const res = await fetch(`/api/checks/${checkId}/agents`);
      if (res.ok) {
        const data = await res.json();
        if (data.agents && Array.isArray(data.agents)) {
          setAgentsCards(data.agents);
        }
      }
    } catch {}
  }, [checkId]);

  const cardsDebounceTimer = useRef(null);
  const debouncedFetchAgentsCards = useCallback(() => {
    if (cardsDebounceTimer.current) clearTimeout(cardsDebounceTimer.current);
    cardsDebounceTimer.current = setTimeout(() => {
      fetchAgentsCards();
    }, 400);
  }, [fetchAgentsCards]);

  // Fetch Report Data
  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/checks/${checkId}/report`);
      if (res.ok) {
        const data = await res.json();
        const rep = data.report || data;
        setReport(rep);
        if (data.scoreBreakdown) {
          setScoreBreakdown(data.scoreBreakdown);
        }
        setStatus("report_ready");
        updateLocalHistory(checkRef.current, rep);
      } else if (res.status === 409) {
        if (checkRef.current?.status === "failed") {
          setStatus("failed");
          setError("Analysis failed, retry");
        } else {
          setTimeout(fetchReport, 1500);
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        if (checkRef.current?.status === "failed") {
          setStatus("failed");
          setError(errJson.error || "Analysis failed, retry");
        }
      }
    } catch {}
  }, [checkId, updateLocalHistory]);

  // Fetch Check Status & Data with transient 404 retries
  const fetchCheck = useCallback(async (retryCount = 0) => {
    try {
      const res = await fetch(`/api/checks/${checkId}`);
      if (!res.ok) {
        if (res.status === 404) {
          if (retryCount < 3) {
            await new Promise((r) => setTimeout(r, 600 * (retryCount + 1)));
            return fetchCheck(retryCount + 1);
          }
          setStatus("failed");
          setError("Check not found or expired (24h TTL exceeded).");
          return;
        }
        throw new Error(`Failed to fetch check: HTTP ${res.status}`);
      }

      const data = await res.json();
      const checkData = data.check || data;
      setCheck(checkData);
      checkRef.current = checkData;
      setEntities(data.entities || []);
      setExtractedText(data.text || checkData.text || "");

      const currentStatus = checkData.status;

      if (currentStatus === "awaiting_confirmation") {
        setStatus("awaiting_confirmation");
      } else if (currentStatus === "investigating" || currentStatus === "scoring") {
        setStatus("investigating");
        fetchAgentsCards();
      } else if (currentStatus === "report_ready" || currentStatus === "completed") {
        fetchReport();
        fetchAgentsCards();
      } else if (currentStatus === "failed") {
        setStatus("failed");
        setError(checkData.failure_reason || "Analysis failed, retry");
      } else if (currentStatus === "created" || currentStatus === "extracting") {
        setStatus("extracting");
        setTimeout(() => fetchCheck(0), 1200);
      }
    } catch (err) {
      setError(err.message || "Failed to load check.");
    }
  }, [checkId, fetchAgentsCards, fetchReport]);

  useEffect(() => {
    if (!checkId) return;
    fetchCheck();
  }, [checkId, fetchCheck]);

  // Polling fallback while investigating
  useEffect(() => {
    if (status !== "investigating" && status !== "scoring") return;
    const interval = setInterval(() => {
      fetchCheck();
      fetchAgentsCards();
    }, 3000);
    return () => clearInterval(interval);
  }, [status, checkId, fetchCheck, fetchAgentsCards]);

  // SSE Stream listener
  useEffect(() => {
    if (!checkId || (status !== "investigating" && status !== "awaiting_confirmation")) return;

    let eventSource = null;
    try {
      eventSource = new EventSource(`/api/checks/${checkId}/stream`);

      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setStreamEvents((prev) => [parsed, ...prev.slice(0, 49)]);

          if (parsed.type === "agent_status" || parsed.type === "tool_call") {
            debouncedFetchAgentsCards();
          }

          if (parsed.type === "verdict" || parsed.type === "pipeline_completed" || parsed.type === "report_ready") {
            fetchReport();
            fetchAgentsCards();
          }
        } catch {}
      };

      eventSource.onerror = () => {
        if (eventSource) eventSource.close();
      };
    } catch {}

    return () => {
      if (eventSource) eventSource.close();
      if (cardsDebounceTimer.current) clearTimeout(cardsDebounceTimer.current);
    };
  }, [checkId, status, debouncedFetchAgentsCards, fetchAgentsCards, fetchReport]);

  // Confirm extracted entities & start verification
  const handleConfirmCheck = async (confirmedEntities) => {
    setIsConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/checks/${checkId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entities: confirmedEntities }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || "Confirmation failed.");
      }

      setStatus("investigating");
      setIsConfirming(false);
      fetchAgentsCards();
    } catch (err) {
      setError(err.message || "Failed to confirm inputs.");
      setIsConfirming(false);
    }
  };

  const copyChecklist = () => {
    if (!report?.checklist) return;
    const text = report.checklist
      .map((item, idx) => `${idx + 1}. ${typeof item === "string" ? item : item.text}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopiedChecklist(true);
      setTimeout(() => setCopiedChecklist(false), 2000);
    });
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 md:py-12">
      {/* Top breadcrumb & case identifier */}
      <div className="flex items-center justify-between text-xs text-neutral-500 mb-6 pb-3 border-b border-[#E5E7EB] dark:border-white/10 font-mono">
        <div className="flex items-center gap-2">
          <Link href="/" className="hover:text-[#0A0A0A] dark:hover:text-white transition-colors">
            Home
          </Link>
          <span>/</span>
          <Link href="/history" className="hover:text-[#0A0A0A] dark:hover:text-white transition-colors">
            History
          </Link>
          <span>/</span>
          <span className="text-[#0A0A0A] dark:text-white font-medium">
            Case #{checkId ? checkId.slice(0, 8) : ""}
          </span>
        </div>
        <div className="text-[11px] text-neutral-400">
          24h TTL
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2.5">
          <svg className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
          </svg>
          <span className="leading-snug">{error}</span>
        </div>
      )}

      {/* STATE 1: EXTRACTING / LOADING */}
      {(status === "loading" || status === "created" || status === "extracting") && (
        <Card className="text-center py-16 px-6">
          <div className="w-8 h-8 rounded-full border-2 border-[#0A0A0A] dark:border-white border-t-transparent animate-spin mx-auto mb-4" />
          <h2 className="text-lg sm:text-xl font-bold text-[#0A0A0A] dark:text-white mb-2">
            Extracting text &amp; identifiers...
          </h2>
          <p className="text-xs sm:text-sm text-neutral-600 dark:text-neutral-400 max-w-md mx-auto leading-relaxed">
            Parsing offer text and screenshot attachments to extract payment handles, companies, links, and contact information.
          </p>
        </Card>
      )}

      {/* STATE 5: FAILED ANALYSIS */}
      {status === "failed" && (
        <Card className="text-center py-12 px-6 border-rose-200 dark:border-rose-900/40 bg-rose-50/30 dark:bg-rose-950/10">
          <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
            Analysis failed, retry
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 max-w-md mx-auto mb-6 leading-relaxed">
            {error || "An unexpected error occurred during multi-agent verification. No public registry verdict could be finalized."}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              type="button"
              onClick={() => {
                setStatus("extracting");
                setError(null);
                fetchCheck(0);
              }}
              className="px-4 py-2 text-xs font-semibold"
            >
              Retry Analysis
            </Button>
            <Link
              href="/check"
              className="px-4 py-2 text-xs font-mono font-medium rounded-md border border-[#E5E7EB] dark:border-white/10 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
            >
              Start New Check
            </Link>
          </div>
        </Card>
      )}

      {/* STATE 2: AWAITING CONFIRMATION */}
      {status === "awaiting_confirmation" && (
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0A0A0A] dark:text-white">
              Confirm extracted details
            </h1>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Review what was found. Add any missing identifiers or remove incorrect items before starting multi-agent verification.
            </p>
          </div>

          {extractedText && (
            <Card className="p-4 bg-neutral-50/70 dark:bg-white/[0.02]">
              <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2 block">
                Extracted Message Text
              </span>
              <p className="text-xs font-mono text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                {extractedText}
              </p>
            </Card>
          )}

          <EntitiesEditor
            initialEntities={entities}
            onConfirm={handleConfirmCheck}
            confirming={isConfirming}
            disabled={isConfirming}
          />
        </div>
      )}

      {/* STATE 3: INVESTIGATING (Live Progress) */}
      {status === "investigating" && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-neutral-50 dark:bg-white/[0.03] border border-[#E5E7EB] dark:border-white/10">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div>
                <h2 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
                  Multi-Agent Investigation in Progress
                </h2>
                <p className="text-xs text-neutral-500">
                  Six specialist agents are analyzing registry databases and public records.
                </p>
              </div>
            </div>
            <div className="text-xs font-mono text-neutral-500 shrink-0">
              Round {check?.current_round || 1} of 2
            </div>
          </div>

          {/* 6 Specialist Agent Cards */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-3">
              Specialist Agents (Select to inspect activity logs)
            </h3>
            <AgentCards
              agents={agentsCards}
              onSelectAgent={(agent) => setSelectedAgent(agent)}
            />
          </div>

          {/* Live Activity Feed */}
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E5E7EB] dark:border-white/10 bg-neutral-50/80 dark:bg-white/[0.02] flex items-center justify-between">
              <span className="text-xs font-semibold text-[#0A0A0A] dark:text-white">
                Live verification trace
              </span>
              <span className="text-[11px] font-mono text-neutral-400">
                {streamEvents.length} events
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-[#E5E7EB] dark:divide-white/5 p-1">
              {streamEvents.length === 0 ? (
                <div className="p-8 text-center text-xs text-neutral-400 font-mono">
                  Connecting to live agent events...
                </div>
              ) : (
                streamEvents.map((ev, idx) => (
                  <div key={idx} className="p-2.5 px-3 flex items-center gap-3 text-xs font-mono">
                    <span className="text-neutral-400 shrink-0 text-[11px]">
                      {ev.ts ? new Date(ev.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        ev.type === "flag"
                          ? "bg-rose-500"
                          : ev.status === "error"
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                    />
                    <span className="text-neutral-500 w-28 shrink-0 truncate">[{ev.agent || "coordinator"}]</span>
                    <span className="text-neutral-900 dark:text-neutral-200 truncate flex-1 font-sans text-xs">
                      {ev.summary || ev.text || ev.title || ev.tool || ev.type}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* STATE 4: REPORT READY (Completed Final Report) */}
      {status === "report_ready" && report && (
        <div className="flex flex-col gap-8 print:p-0">
          {/* Header & Verdict */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between text-xs font-mono text-neutral-500">
              <span className="tracking-wider text-neutral-600 dark:text-neutral-400 font-medium">
                Opportunity Risk Assessment · Assessed Risk Level
              </span>
              <span>
                Generated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`w-3.5 h-3.5 rounded-full inline-block shrink-0 ${
                    report.riskLevel === "high"
                      ? "bg-rose-600"
                      : report.riskLevel === "medium"
                      ? "bg-amber-500"
                      : report.riskLevel === "low"
                      ? "bg-emerald-600"
                      : report.riskLevel === "cannot_verify"
                      ? "bg-neutral-500"
                      : "bg-rose-500"
                  }`}
                  id="verdict-dot"
                />
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#0A0A0A] dark:text-white" id="verdict-headline">
                  {report.riskLevel === "high"
                    ? "HIGH RISK"
                    : report.riskLevel === "medium"
                    ? "MEDIUM RISK"
                    : report.riskLevel === "low"
                    ? "LOW RISK"
                    : report.riskLevel === "cannot_verify"
                    ? "CANNOT VERIFY"
                    : "Analysis failed, retry"}
                </h1>
              </div>

              <div className="text-xs text-neutral-500 font-mono">
                Confidence: <strong className="text-neutral-800 dark:text-neutral-200">{String(report.confidence || "standard").toUpperCase()}</strong>
                {report.score !== null && report.score !== undefined && (
                  <span> · Score: {report.score}/100</span>
                )}
              </div>
            </div>

            {/* Score Bar */}
            <div className="w-full bg-[#E5E7EB] dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${report.score ?? (report.riskLevel === "high" ? 92 : report.riskLevel === "medium" ? 54 : report.riskLevel === "low" ? 8 : 0)}%`,
                  backgroundColor:
                    report.riskLevel === "high"
                      ? "#E11D48"
                      : report.riskLevel === "medium"
                      ? "#F59E0B"
                      : report.riskLevel === "low"
                      ? "#10B981"
                      : "#6B7280",
                }}
                id="risk-score-bar"
              />
            </div>

            {/* Bilingual Narrative Summary */}
            <Card className="p-5 mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide font-mono">
                  Executive Summary
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSummaryLang("en")}
                    className={`px-2 py-0.5 rounded text-xs font-mono font-medium transition-colors ${
                      summaryLang === "en"
                        ? "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A]"
                        : "text-neutral-500 hover:text-black dark:hover:text-white"
                    }`}
                  >
                    EN
                  </button>
                  <span className="text-neutral-300 text-xs">/</span>
                  <button
                    type="button"
                    onClick={() => setSummaryLang("hi")}
                    className={`px-2 py-0.5 rounded text-xs font-mono font-medium transition-colors ${
                      summaryLang === "hi"
                        ? "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A]"
                        : "text-neutral-500 hover:text-black dark:hover:text-white"
                    }`}
                  >
                    हि
                  </button>
                </div>
              </div>

              <p className="text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed font-sans" id="verdict-summary">
                {summaryLang === "hi" && report.summaryHindi ? report.summaryHindi : report.summary}
              </p>
            </Card>
          </section>

          {/* Section: Flags Detected */}
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-bold text-[#0A0A0A] dark:text-white flex items-center justify-between">
              <span>Risk flags detected ({report.flags?.length || 0})</span>
            </h2>

            {(!report.flags || report.flags.length === 0) ? (
              <Card className="p-6 text-center text-sm text-neutral-500">
                No specific red flags identified in public registries. Remember that no findings is not the same as safe.
              </Card>
            ) : (
              <div className="space-y-3">
                {report.flags.map((flag) => (
                  <Card key={flag.id} className="p-4 flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            flag.severity === "high" ? "bg-rose-600" : flag.severity === "medium" ? "bg-amber-500" : "bg-neutral-500"
                          }`}
                        />
                        <h3 className="text-sm font-semibold text-[#0A0A0A] dark:text-white">
                          {flag.title}
                        </h3>
                      </div>
                      <Badge variant={flag.severity}>{flag.severity}</Badge>
                    </div>

                    <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                      {flag.explanation}
                    </p>

                    {flag.evidence && flag.evidence.length > 0 && (
                      <div className="mt-1 pt-2 border-t border-[#E5E7EB] dark:border-white/5 space-y-1.5">
                        <span className="text-[11px] font-mono text-neutral-500 block">
                          Recorded Evidence:
                        </span>
                        {flag.evidence.map((ev, i) => (
                          <div
                            key={i}
                            className="p-2 rounded bg-neutral-50 dark:bg-white/[0.03] border border-[#E5E7EB] dark:border-white/10 font-mono text-xs text-neutral-800 dark:text-neutral-200"
                          >
                            &ldquo;{ev.value}&rdquo;
                            {ev.sourceAgent && (
                              <span className="text-neutral-400 ml-2 text-[10px]">
                                via {ev.sourceAgent}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Optional Link Content Extraction (PRD §8) */}
          {entities.filter((e) => e.confirmed && (e.kind === "url" || e.kind === "domain")).length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-bold text-[#0A0A0A] dark:text-white">
                {summaryLang === "hi" ? "वैकल्पिक लिंक सामग्री निष्कर्षण" : "Optional Link Content Extraction"}
              </h2>
              {entities
                .filter((e) => e.confirmed && (e.kind === "url" || e.kind === "domain"))
                .map((ent) => (
                  <LinkExtractionCard
                    key={ent.id}
                    checkId={checkId}
                    entity={ent}
                    lang={summaryLang}
                  />
                ))}
            </section>
          )}

          {/* Section: Verified Facts */}
          {report.verified && report.verified.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-bold text-[#0A0A0A] dark:text-white">
                Verified facts ({report.verified.length})
              </h2>
              <Card className="p-4">
                <ul className="space-y-2 text-xs text-neutral-700 dark:text-neutral-300">
                  {report.verified.map((v, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{typeof v === "string" ? v : v.fact || v.name}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {/* Section: Could Not Check (Degraded Limits) */}
          {report.couldNotCheck && report.couldNotCheck.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-bold text-neutral-700 dark:text-neutral-300">
                Could not verify automatically ({report.couldNotCheck.length})
              </h2>
              <Card className="p-4 bg-neutral-50/50 dark:bg-white/[0.01]">
                <ul className="space-y-1.5 text-xs text-neutral-500">
                  {report.couldNotCheck.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 font-mono text-[11px]">
                      <span>·</span>
                      <span>{typeof item === "string" ? item : item.name || item.reason}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {/* Section: Checklist */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#0A0A0A] dark:text-white">
                What to verify next
              </h2>
              <button
                type="button"
                onClick={copyChecklist}
                className="text-xs font-semibold text-neutral-900 dark:text-white hover:underline flex items-center gap-1"
              >
                {copiedChecklist ? "Copied!" : "Copy checklist"}
              </button>
            </div>
            <Checklist checklist={report.checklist || []} moreChecks={report.moreChecks || []} />
          </section>

          {/* Section: Evidence Coverage */}
          {report.coverage && (
            <CoverageCard
              coverage={report.coverage}
              improveCheck={report.improveCheck || []}
            />
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-[#E5E7EB] dark:border-white/10 print:hidden">
            <Button
              variant="outline"
              size="md"
              onClick={() => setCollegeModalOpen(true)}
            >
              Email college authority
            </Button>

            <Link href="/report-fraud">
              <Button variant="danger" size="md">
                I already paid money
              </Button>
            </Link>

            <Button
              variant="ghost"
              size="md"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </Button>

            <Button
              variant="ghost"
              size="md"
              onClick={() => setFeedbackModalOpen(true)}
            >
              Send feedback
            </Button>
          </div>
        </div>
      )}

      {/* Modals & Drawers */}
      {selectedAgent && (
        <AgentActivityDrawer
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}

      {collegeModalOpen && (
        <CollegeEmailModal
          check={check}
          report={report}
          onClose={() => setCollegeModalOpen(false)}
        />
      )}

      {feedbackModalOpen && (
        <FeedbackModal
          checkId={checkId}
          onClose={() => setFeedbackModalOpen(false)}
        />
      )}
    </div>
  );
}

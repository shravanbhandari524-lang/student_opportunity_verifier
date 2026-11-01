"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import Link from "next/link";
import AgentCards from "../../../components/AgentCards.js";
import AgentActivityDrawer from "../../../components/AgentActivityDrawer.js";
import RiskBadge from "../../../components/RiskBadge.js";
import FlagCard from "../../../components/FlagCard.js";
import Checklist from "../../../components/Checklist.js";
import CoverageCard from "../../../components/CoverageCard.js";
import EntitiesEditor from "../../../components/EntitiesEditor.js";
import LinkExtractionCard from "../../../components/LinkExtractionCard.js";
import { CollegeEmailModal, FeedbackModal } from "../../../components/ActionModals.js";

export default function CheckDetailPage({ params }) {
  const unwrappedParams = use(params);
  const checkId = unwrappedParams.id;

  const [check, setCheck] = useState(null);
  const [entities, setEntities] = useState([]);
  const [extractedText, setExtractedText] = useState("");
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("loading"); // loading, extracting, awaiting_confirmation, investigating, scoring, report_ready, failed
  const [error, setError] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // Live Progress & Agent Cards
  const [agentsCards, setAgentsCards] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [streamEvents, setStreamEvents] = useState([]);
  const [streamConnected, setStreamConnected] = useState(false);

  // Report & View options
  const [summaryLang, setSummaryLang] = useState("en"); // "en" or "hi"
  const [collegeModalOpen, setCollegeModalOpen] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);

  // Update local device history with latest status/score
  const updateLocalHistory = useCallback((checkData, reportData) => {
    try {
      const raw = localStorage.getItem("ov_recent_checks");
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
      localStorage.setItem("ov_recent_checks", JSON.stringify(updated));
    } catch {}
  }, [checkId]);

  // Fetch Agent Cards & Activities
  const fetchAgentsCards = useCallback(async () => {
    try {
      const res = await fetch(`/api/checks/${checkId}/agents`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.agents)) {
          setAgentsCards(data.agents);
        }
      }
    } catch {}
  }, [checkId]);

  // Fetch Final Report
  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/checks/${checkId}/report`);
      if (res.ok) {
        const data = await res.json();
        const rep = data.report || data;
        setReport(rep);
        setStatus("report_ready");
        fetchAgentsCards();
        updateLocalHistory(null, rep);
      } else if (res.status === 409) {
        // Still scoring; wait and poll
        setTimeout(fetchReport, 1500);
      }
    } catch {}
  }, [checkId, fetchAgentsCards, updateLocalHistory]);

  // Initial Status Poll
  useEffect(() => {
    let timerId = null;
    let cancelled = false;

    async function pollStatus() {
      try {
        const res = await fetch(`/api/checks/${checkId}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error("Check not found or expired after 24 hours.");
          throw new Error("Failed to load check status.");
        }
        const data = await res.json();
        if (cancelled) return;

        setCheck(data.check);
        if (Array.isArray(data.entities)) setEntities(data.entities);
        if (data.text) setExtractedText(data.text);

        const currentStatus = data.check.status;
        setStatus(currentStatus);

        if (currentStatus === "extracting" || currentStatus === "created") {
          timerId = setTimeout(pollStatus, 2000);
        } else if (currentStatus === "report_ready") {
          fetchReport();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStatus("failed");
        }
      }
    }

    pollStatus();

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [checkId, fetchReport]);

  // Real-time SSE Stream & Polling Fallback during Investigation
  useEffect(() => {
    if (status !== "investigating" && status !== "scoring") return;

    let eventSource = null;
    let pollTimer = null;
    let lastSeq = 0;
    let cleanedUp = false;
    let lastAgentFetch = 0;

    function throttledFetchAgents() {
      const now = Date.now();
      if (now - lastAgentFetch > 3000) {
        lastAgentFetch = now;
        fetchAgentsCards();
      }
    }

    // Initial agent fetch
    fetchAgentsCards();

    function handleEvent(ev) {
      if (typeof ev.seq === "number" && ev.seq > lastSeq) {
        lastSeq = ev.seq;
      }

      setStreamEvents((prev) => {
        if (typeof ev.seq === "number" && prev.some((p) => p.seq === ev.seq)) return prev;
        return [ev, ...prev.slice(0, 39)];
      });

      if (ev.type === "agent_status") {
        throttledFetchAgents();
      }

      if (ev.type === "complete" || ev.stage === "report_ready") {
        setStatus("report_ready");
        fetchReport();
      }
    }

    function startPollingFallback() {
      if (cleanedUp || pollTimer) return;
      setStreamConnected(false);

      async function poll() {
        if (cleanedUp) return;
        try {
          const res = await fetch(`/api/checks/${checkId}/events?after=${lastSeq}`);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.events)) {
              for (const ev of data.events) handleEvent(ev);
            }
          }
          const chk = await fetch(`/api/checks/${checkId}`);
          if (chk.ok) {
            const chkData = await chk.json();
            if (chkData.check?.status === "report_ready") {
              setStatus("report_ready");
              fetchReport();
              return;
            }
          }
          throttledFetchAgents();
        } catch {}
        if (!cleanedUp) pollTimer = setTimeout(poll, 3000);
      }

      poll();
    }

    try {
      eventSource = new EventSource(`/api/checks/${checkId}/stream`);
      setStreamConnected(true);

      eventSource.onmessage = (event) => {
        if (cleanedUp) return;
        try {
          const parsed = JSON.parse(event.data);
          handleEvent(parsed);
        } catch {}
      };

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        startPollingFallback();
      };
    } catch {
      startPollingFallback();
    }

    return () => {
      cleanedUp = true;
      if (eventSource) eventSource.close();
      if (pollTimer) clearTimeout(pollTimer);
      setStreamConnected(false);
    };
  }, [status, checkId, fetchAgentsCards, fetchReport]);

  // Confirmation Trigger
  async function handleConfirm(confirmedEntities) {
    setIsConfirming(true);
    setError(null);

    try {
      const texts = extractedText.trim() ? [extractedText.trim()] : [];
      const res = await fetch(`/api/checks/${checkId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, entities: confirmedEntities }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || "Confirmation failed");
      }

      setStatus("investigating");
      fetchAgentsCards();
    } catch (err) {
      setError(err.message || "Failed to start investigation");
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className="container-wide" style={{ padding: "2rem 1rem 4rem 1rem" }}>
      {/* Workspace Sub-header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          paddingBottom: "1rem",
          marginBottom: "1.5rem",
          borderBottom: "1px solid var(--border-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Link href="/" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>
            ← Home
          </Link>
          <span style={{ color: "var(--text-muted)" }}>/</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-secondary)" }}>
            Case #{checkId.slice(0, 8)}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              padding: "2px 6px",
              backgroundColor: "var(--bg-muted)",
              borderRadius: "var(--radius-sm)",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
            }}
          >
            {status.replace("_", " ")}
          </span>
        </div>

        {check?.expiresAt && (
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            Expires: {new Date(check.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (24h TTL)
          </span>
        )}
      </div>

      {/* STATE 1: EXTRACTING / CREATED */}
      {(status === "loading" || status === "created" || status === "extracting") && (
        <div className="panel" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
          <span className="spinner" style={{ width: "24px", height: "24px", marginBottom: "1rem" }} />
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.5rem" }}>
            Extracting Identifiers &amp; Evidence...
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", maxWidth: "55ch", margin: "0 auto", lineHeight: 1.5 }}>
            Our vision engine is reading text messages, sender handles, payment VPAs, and web links from your submission.
          </p>
        </div>
      )}

      {/* STATE 2: AWAITING CONFIRMATION */}
      {status === "awaiting_confirmation" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: "860px", margin: "0 auto" }}>
          <div className="panel">
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "0.5rem" }}>
              Confirm Extracted Text &amp; Identifiers
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "1rem" }}>
              Ensure the detected text and organization details are accurate. Specialists will search public databases using these exact identifiers.
            </p>

            {extractedText && (
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: "4px" }}>
                  Extracted Message Transcript:
                </label>
                <textarea
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  className="input-field"
                  rows={4}
                />
              </div>
            )}

            <EntitiesEditor
              initialEntities={entities}
              onConfirm={handleConfirm}
              confirming={isConfirming}
              error={error}
            />
          </div>
        </div>
      )}

      {/* STATE 3: INVESTIGATING / SCORING (Live Progress) */}
      {(status === "investigating" || status === "scoring") && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="panel-subtle" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="status-dot emerald" aria-hidden="true" />
              <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                {status === "scoring" ? "Reconciling Evidence & Evaluating Risk Score..." : "Multi-Agent Investigation in Progress..."}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              <span>Stream: {streamConnected ? "Live SSE" : "Polling Fallback"}</span>
              <span className="status-dot amber" />
            </div>
          </div>

          {/* 6 Canonical Specialist Agent Cards */}
          <div>
            <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.04em", display: "block", marginBottom: "8px" }}>
              Specialist Agents (Click card to inspect execution telemetry):
            </span>
            <AgentCards
              agents={agentsCards}
              onSelectAgent={(agent) => setSelectedAgent(agent)}
            />
          </div>

          {/* Real-time Telemetry Timeline Feed */}
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-divider)", backgroundColor: "var(--bg-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-primary)", textTransform: "uppercase" }}>
                Live Execution Feed
              </span>
              <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                {streamEvents.length} events
              </span>
            </div>

            <div style={{ maxHeight: "320px", overflowY: "auto" }}>
              {streamEvents.length === 0 ? (
                <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                  Awaiting tool execution events from parallel agents...
                </div>
              ) : (
                streamEvents.map((ev, idx) => (
                  <div key={idx} className="feed-row">
                    <span className="feed-timestamp">
                      {ev.ts ? new Date(ev.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--:--"}
                    </span>
                    <span className={`status-dot ${ev.type === "flag" ? "crimson" : ev.status === "error" ? "amber" : "emerald"}`} />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)", width: "130px", flexShrink: 0 }}>
                      [{ev.agent || "coordinator"}]
                    </span>
                    <span style={{ fontSize: "13px", color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ev.summary || ev.text || ev.title || ev.tool || ev.type}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* STATE 4: REPORT READY */}
      {status === "report_ready" && report && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
          <div>
            <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.04em" }}>
              Assessed Risk Level
            </span>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", marginTop: "2px" }}>
              Opportunity Risk Assessment
            </h1>
          </div>

          {/* Top Banner with Verdict, Score & Confidence */}
          <RiskBadge
            level={report.riskLevel}
            score={report.score}
            confidence={report.confidence}
            rulesFired={report.whereDisagreed && report.whereDisagreed.length > 0 ? report.whereDisagreed : []}
          />

          {/* Bilingual Narrative Summary */}
          <div className="panel">
            <div className="panel-header">
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
                Assessment Summary
              </h2>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  type="button"
                  onClick={() => setSummaryLang("en")}
                  className={`btn btn-sm ${summaryLang === "en" ? "btn-primary" : "btn-secondary"}`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setSummaryLang("hi")}
                  className={`btn btn-sm ${summaryLang === "hi" ? "btn-primary" : "btn-secondary"}`}
                >
                  हिंदी
                </button>
              </div>
            </div>
            <p style={{ fontSize: "14px", color: "var(--text-primary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {report.summary}
            </p>
          </div>

          {/* Evidence Coverage Card (PRD §11) */}
          <CoverageCard
            coverage={report.coverage}
            improveCheck={report.improveCheck}
          />

          {/* Optional Link Content Extraction (PRD §8 / PART 5) */}
          {entities.filter((e) => e.confirmed && (e.kind === "url" || e.kind === "domain")).length > 0 && (
            <section aria-labelledby="link-extraction-heading" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="panel-header" style={{ border: "none", marginBottom: 0, paddingBottom: 0 }}>
                <h2 id="link-extraction-heading" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                  {summaryLang === "hi" ? "वैकल्पिक लिंक सामग्री निष्कर्षण" : "Optional Link Content Extraction"}
                </h2>
              </div>
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

          {/* Red-Flag Cards */}
          <section aria-labelledby="flags-heading">
            <div className="panel-header" style={{ border: "none", marginBottom: "0.5rem" }}>
              <h2 id="flags-heading" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
                Red-Flag Findings ({report.flags?.length || 0})
              </h2>
            </div>

            {(!report.flags || report.flags.length === 0) ? (
              <div className="panel-subtle" style={{ padding: "1rem", color: "var(--text-secondary)", fontSize: "13px" }}>
                ✓ No overt scam red flags were triggered by our specialists. <em>Note: Missing red flags is not a guarantee of safety. Always confirm directly with official university or corporate portals.</em>
              </div>
            ) : (
              report.flags.map((flag, idx) => (
                <FlagCard key={idx} flag={flag} />
              ))
            )}
          </section>

          {/* Verified Items & Could Not Check Side-by-Side Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
            {/* Verified Facts */}
            <div className="panel">
              <div className="panel-header">
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--status-emerald)" }}>
                  ✓ Positive Verified Claims ({report.verified?.length || 0})
                </h3>
              </div>
              {(!report.verified || report.verified.length === 0) ? (
                <span style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>
                  No claims could be officially corroborated via registry records.
                </span>
              ) : (
                <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
                  {report.verified.map((v, i) => (
                    <li key={i} style={{ color: "var(--text-primary)" }}>
                      {typeof v === "string" ? v : v.text || JSON.stringify(v)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Could Not Check / Skipped Items */}
            <div className="panel">
              <div className="panel-header">
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-secondary)" }}>
                  ⊘ Could Not Check / Skipped
                </h3>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "13px" }}>
                {report.couldNotCheck?.length > 0 && (
                  <div>
                    <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--status-amber)", textTransform: "uppercase" }}>
                      Failed or Timed Out Checks ({report.couldNotCheck.length}):
                    </span>
                    <ul style={{ paddingLeft: "1.25rem", marginTop: "3px" }}>
                      {report.couldNotCheck.map((c, i) => (
                        <li key={i} style={{ color: "var(--text-secondary)" }}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.notApplicable?.length > 0 && (
                  <div>
                    <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase" }}>
                      Not Applicable Given Inputs ({report.notApplicable.length}):
                    </span>
                    <ul style={{ paddingLeft: "1.25rem", marginTop: "3px" }}>
                      {report.notApplicable.map((n, i) => (
                        <li key={i} style={{ color: "var(--text-muted)" }}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(!report.couldNotCheck?.length && !report.notApplicable?.length) && (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    All eligible checks completed normally.
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Checklist */}
          <Checklist
            checklist={report.checklist}
            moreChecks={report.moreChecks}
          />

          {/* Action Buttons: College Email, Fraud Helpline, Feedback */}
          <div className="panel-subtle" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setCollegeModalOpen(true)}
                className="btn btn-primary"
              >
                ✉ Draft Email to College / TPO
              </button>
              <Link
                href={`/report-fraud?check=${checkId}`}
                className="btn btn-secondary"
              >
                🚨 Already Paid? File Complaint
              </Link>
            </div>

            <button
              type="button"
              onClick={() => setFeedbackModalOpen(true)}
              className="btn btn-ghost btn-sm"
              style={{ textDecoration: "underline" }}
            >
              Was this assessment right or wrong?
            </button>
          </div>

          {/* Specialist Activity Drawer Inspection Bar */}
          <div style={{ marginTop: "1rem" }}>
            <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.04em", display: "block", marginBottom: "8px" }}>
              Detailed Agent Findings &amp; Forensic Logs:
            </span>
            <AgentCards
              agents={agentsCards}
              onSelectAgent={(agent) => setSelectedAgent(agent)}
            />
          </div>
        </div>
      )}

      {/* STATE 5: FAILED */}
      {status === "failed" && (
        <div className="panel" style={{ padding: "2rem", borderLeft: "4px solid var(--status-crimson)" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--status-crimson-text)", marginBottom: "0.5rem" }}>
            Check Failed or Expired
          </h2>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "1rem" }}>
            {error || check?.failureReason || "The investigation timed out or the requested check is no longer available in the 24-hour cache."}
          </p>
          <Link href="/check" className="btn btn-primary">
            Start a new check →
          </Link>
        </div>
      )}

      {/* Slide-over Agent Activity Drawer */}
      <AgentActivityDrawer
        agent={selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />

      {/* Action Modals */}
      <CollegeEmailModal
        checkId={checkId}
        isOpen={collegeModalOpen}
        onClose={() => setCollegeModalOpen(false)}
      />

      <FeedbackModal
        checkId={checkId}
        isOpen={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
      />
    </div>
  );
}

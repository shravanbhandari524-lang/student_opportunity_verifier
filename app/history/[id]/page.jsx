"use client";

import { useState, useEffect } from "react";
import Link from "next/link.js";
import { useParams } from "next/navigation.js";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Button from "../../../components/ui/Button.jsx";

export default function RunDetailPage() {
  const params = useParams();
  const runId = params?.id;

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedAgents, setExpandedAgents] = useState({});

  useEffect(() => {
    if (!runId) return;

    let isMounted = true;
    async function fetchRecord() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/history/${runId}`);
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("Verification run record not found or expired (records expire after 24 hours).");
          }
          throw new Error(`Failed to load run record (HTTP ${res.status}).`);
        }
        const data = await res.json();
        if (isMounted) {
          setRecord(data);
          // By default, if any agent failed, expand that agent
          const initialExpanded = {};
          if (Array.isArray(data.agents)) {
            data.agents.forEach((ag) => {
              if (ag.status === "failed") {
                initialExpanded[ag.agent_name] = true;
              }
            });
          }
          setExpandedAgents(initialExpanded);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load verification record");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchRecord();
    return () => {
      isMounted = false;
    };
  }, [runId]);

  function toggleAgent(agentName) {
    setExpandedAgents((prev) => ({
      ...prev,
      [agentName]: !prev[agentName],
    }));
  }

  function calculateDuration(start, end) {
    if (!start || !end) return "N/A";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (isNaN(ms) || ms < 0) return "N/A";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case "completed":
        return "border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200";
      case "failed":
        return "border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 font-semibold";
      case "running":
        return "border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400";
      case "queued":
      default:
        return "border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-500";
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-12 text-center">
        <p className="text-sm font-mono text-neutral-500">Loading run record...</p>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="mb-6">
          <Link
            href="/history"
            className="text-xs font-mono text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            &larr; Back to Run History
          </Link>
        </div>
        <Card className="p-8 border border-red-200 dark:border-red-900 bg-red-50/30 dark:bg-red-950/20 text-center">
          <h2 className="text-base font-semibold text-red-900 dark:text-red-200 mb-2">
            Record Unavailable
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 max-w-md mx-auto mb-6">
            {error || "Verification record could not be found."}
          </p>
          <Link href="/history">
            <Button variant="outline" size="sm">
              Return to Run History
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const scoreDisplay = typeof record.final_score === "number"
    ? `${record.final_score} / 100`
    : (record.final_score || "Unavailable");

  const scoreUnavailableReason = record.score_unavailable_reason || (record.final_score === "Unavailable" ? "Insufficient verifiable signals to compute score" : null);

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 md:py-12 space-y-8">
      {/* Navigation & Header */}
      <div>
        <Link
          href="/history"
          className="text-xs font-mono text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors inline-block mb-4"
        >
          &larr; Back to Run History
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 dark:border-neutral-800 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              Verification Run Detail
            </h1>
            <p className="mt-1 text-xs font-mono text-neutral-500">
              Run ID: <span className="select-all text-neutral-800 dark:text-neutral-200">{record.run_id}</span> • Created {new Date(record.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/check/${record.run_id}`}>
              <Button variant="outline" size="sm">
                View Public Report
              </Button>
            </Link>
            <Link href="/check">
              <Button variant="primary" size="sm">
                New Verification
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Top Section: Score, Verdict & Executive Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Verdict & Score Card */}
        <div className="p-6 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4">
          <div>
            <div className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase mb-1">
              Final Verdict
            </div>
            <Badge variant={record.verdict}>
              {(record.verdict || "cannot_verify").toUpperCase().replace(/_/g, " ")}
            </Badge>
          </div>

          <div className="border-t border-neutral-100 dark:border-neutral-800 pt-4">
            <div className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase mb-1">
              Final Risk Score
            </div>
            <div className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {scoreDisplay}
            </div>
            {scoreUnavailableReason && (
              <p className="text-xs text-neutral-500 mt-1">
                Reason: {scoreUnavailableReason}
              </p>
            )}
          </div>
        </div>

        {/* Executive Final Summary Card */}
        <div className="md:col-span-2 p-6 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase">
              Executive Summary
            </div>
            <p className="text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
              {record.final_summary || "No executive summary recorded for this verification run."}
            </p>
          </div>

          {/* Submission Preview */}
          <div className="mt-4 pt-4 border-t border-neutral-100 dark:border-neutral-800">
            <div className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase mb-1">
              Input Text Evaluated
            </div>
            <p className="text-xs font-mono text-neutral-600 dark:text-neutral-400 line-clamp-2 bg-neutral-50 dark:bg-neutral-950 p-2 rounded border border-neutral-200 dark:border-neutral-800">
              {record.input?.text || record.input?.raw || "No text payload"}
            </p>
            {record.input?.userNotes && (
              <p className="text-xs text-neutral-500 mt-1">
                User context: {record.input.userNotes}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Agent Execution Timeline Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Agent Execution Timeline
            </h2>
            <p className="text-xs text-neutral-500">
              Chronological execution order with per-agent actions, tool steps, and technical findings.
            </p>
          </div>
          <span className="text-xs font-mono text-neutral-500">
            {record.agents?.length || 0} Agents
          </span>
        </div>

        {/* Collapsible Agent Cards */}
        <div className="space-y-3">
          {(!record.agents || record.agents.length === 0) ? (
            <div className="p-8 text-center text-sm text-neutral-500 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-md">
              No agents were executed for this run.
            </div>
          ) : (
            record.agents.map((ag, index) => {
              const isExpanded = Boolean(expandedAgents[ag.agent_name]);
              const duration = calculateDuration(ag.started_at, ag.ended_at);
              const isFailed = ag.status === "failed";

              return (
                <div
                  key={ag.agent_name || index}
                  className={`rounded-md border transition-colors ${
                    isFailed
                      ? "border-red-300 dark:border-red-900 bg-red-50/10 dark:bg-red-950/10"
                      : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
                  }`}
                >
                  {/* Collapsed Header (Summary and Status visible by default) */}
                  <div
                    onClick={() => toggleAgent(ag.agent_name)}
                    className="p-4 sm:p-5 cursor-pointer select-none"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-neutral-400">
                            #{index + 1}
                          </span>
                          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                            {ag.agent_name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                          </span>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${getStatusBadgeClass(
                              ag.status
                            )}`}
                          >
                            {ag.status}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500">
                          {ag.purpose || "Specialist analysis agent"}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-mono text-neutral-500 shrink-0">
                        <span>Duration: {duration}</span>
                        <span className="text-neutral-400">
                          {isExpanded ? "[Collapse]" : "[Expand Details]"}
                        </span>
                      </div>
                    </div>

                    {/* Agent Summary: ALWAYS VISIBLE BY DEFAULT */}
                    <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800/80">
                      <div className="text-[11px] font-mono text-neutral-400 uppercase mb-0.5">
                        Agent Summary
                      </div>
                      <p className="text-xs text-neutral-800 dark:text-neutral-200">
                        {ag.summary || "Agent completed without a summary."}
                      </p>
                    </div>

                    {/* If failed, show error preview right away */}
                    {isFailed && ag.error && (
                      <div className="mt-2 p-2 rounded border border-red-300 dark:border-red-900 bg-red-100/50 dark:bg-red-950/40 text-xs text-red-800 dark:text-red-300 font-mono">
                        Failure Message: {ag.error}
                      </div>
                    )}
                  </div>

                  {/* Expanded Technical Details */}
                  {isExpanded && (
                    <div className="p-4 sm:p-5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/50 space-y-6">
                      {/* Explicit Error Display if Failed */}
                      {isFailed && (
                        <div className="p-3.5 rounded border border-red-300 dark:border-red-800 bg-red-100/70 dark:bg-red-950/50 text-red-900 dark:text-red-200 space-y-1">
                          <div className="text-xs font-mono font-bold uppercase tracking-wider">
                            Agent Error Details
                          </div>
                          <p className="text-xs font-mono">
                            {ag.error || "Execution terminated unexpectedly."}
                          </p>
                        </div>
                      )}

                      {/* Operational Metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                        <div className="p-2.5 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                          <div className="text-neutral-400 text-[10px] uppercase">Started</div>
                          <div className="text-neutral-700 dark:text-neutral-300 truncate">
                            {ag.started_at ? new Date(ag.started_at).toLocaleTimeString() : "N/A"}
                          </div>
                        </div>
                        <div className="p-2.5 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                          <div className="text-neutral-400 text-[10px] uppercase">Ended</div>
                          <div className="text-neutral-700 dark:text-neutral-300 truncate">
                            {ag.ended_at ? new Date(ag.ended_at).toLocaleTimeString() : "N/A"}
                          </div>
                        </div>
                        <div className="p-2.5 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                          <div className="text-neutral-400 text-[10px] uppercase">Duration</div>
                          <div className="text-neutral-700 dark:text-neutral-300">
                            {duration}
                          </div>
                        </div>
                        <div className="p-2.5 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                          <div className="text-neutral-400 text-[10px] uppercase">Score Impact</div>
                          <div className="text-neutral-700 dark:text-neutral-300">
                            {ag.score_contribution !== null && ag.score_contribution !== undefined
                              ? `+${ag.score_contribution} pts`
                              : "0 pts"}
                          </div>
                        </div>
                      </div>

                      {/* Input Received */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase">
                          Input Received by Agent
                        </div>
                        <pre className="p-3 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto max-h-40">
                          {JSON.stringify(ag.input_received || {}, null, 2)}
                        </pre>
                      </div>

                      {/* Steps Timeline */}
                      <div className="space-y-2">
                        <div className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase">
                          Execution Steps ({ag.steps?.length || 0})
                        </div>
                        {(!ag.steps || ag.steps.length === 0) ? (
                          <div className="text-xs text-neutral-400 font-mono italic">
                            No discrete step events recorded.
                          </div>
                        ) : (
                          <div className="space-y-2 border-l border-neutral-300 dark:border-neutral-700 ml-2 pl-3">
                            {ag.steps.map((st, sIdx) => (
                              <div key={sIdx} className="space-y-0.5 relative">
                                <div className="text-[10px] font-mono text-neutral-400">
                                  {st.timestamp ? new Date(st.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }) : "Step"}
                                </div>
                                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                                  {st.action}
                                </div>
                                <div className="text-xs font-mono text-neutral-600 dark:text-neutral-400 bg-white dark:bg-neutral-900 p-2 rounded border border-neutral-200 dark:border-neutral-800">
                                  {st.result}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Raw Output */}
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-mono tracking-wider text-neutral-500 uppercase">
                          Raw Agent Output (JSON)
                        </div>
                        <pre className="p-3 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs font-mono text-neutral-800 dark:text-neutral-200 overflow-x-auto max-h-56">
                          {JSON.stringify(ag.raw_output || {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

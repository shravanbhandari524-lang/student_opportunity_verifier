/**
 * lib/api/sse.js
 *
 * Pure formatting and event streaming helpers for SSE connections:
 * - formatEvent: formats valid SSE frame with id, event, data, retryMs
 * - formatComment: formats keepalive comment (: text\n\n)
 * - parseLastEventId: parses Last-Event-ID header or query param as positive int
 * - streamEvents: async generator yielding SSE frames from database with event bus wakeups,
 *   periodic keepalives, polling fallback, and termination detection.
 */

import { listEventsAfter, getCheck } from "../db/index.js";

/**
 * Formats a message into a standard Server-Sent Event frame.
 * Ensures data is JSON formatted and all newlines within data lines are prefixed with "data: ".
 *
 * @param {object} params
 * @param {number|string} [params.id]
 * @param {string} [params.event="message"]
 * @param {unknown} params.data
 * @param {number} [params.retryMs]
 * @returns {string}
 */
export function formatEvent(params) {
  const parts = [];

  if (params.retryMs !== undefined && Number.isFinite(params.retryMs)) {
    parts.push(`retry: ${Math.floor(params.retryMs)}`);
  }

  if (params.id !== undefined && params.id !== null) {
    parts.push(`id: ${params.id}`);
  }

  if (params.event && typeof params.event === "string") {
    parts.push(`event: ${params.event}`);
  }

  const rawData = typeof params.data === "string" ? params.data : JSON.stringify(params.data);
  // Any internal newlines must be split across multiple data: lines per SSE specification
  const lines = rawData.split(/\r\n|\r|\n/);
  for (const line of lines) {
    parts.push(`data: ${line}`);
  }

  return parts.join("\n") + "\n\n";
}

/**
 * Formats a comment frame for SSE keepalive pings.
 *
 * @param {string} text
 * @returns {string}
 */
export function formatComment(text) {
  return `: ${text.replace(/[\r\n]+/g, " ")}\n\n`;
}

/**
 * Parses Last-Event-ID from request header or query parameter.
 * Returns integer or null.
 *
 * @param {Request} request
 * @returns {number|null}
 */
export function parseLastEventId(request) {
  let raw = request.headers.get("last-event-id");
  if (!raw) {
    try {
      const url = new URL(request.url);
      raw = url.searchParams.get("lastEventId");
    } catch (_e) {}
  }

  if (!raw) return null;
  const num = parseInt(raw, 10);
  if (!Number.isFinite(num) || num < 0 || num > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return num;
}

/**
 * PROVISIONAL backward-compatibility mapper for legacy database check_events rows.
 * Superseded by TraceEvent streaming. Will be audited at L6 backend phase.
 *
 * @param {object} row
 * @returns {object}
 */
export function mapDbEventToProgressEvent(row) {
  if (row.type === "stage") {
    return {
      type: "stage",
      stage: row.status || row.summary || "in_progress",
    };
  }

  if (row.type === "round") {
    return {
      type: "round",
      round: row.round ?? 1,
      status: row.status === "completed" ? "completed" : "started",
    };
  }

  if (row.type === "agent" || row.type === "agent_status") {
    return {
      type: "agent",
      round: row.round ?? 1,
      agent: row.agent || "unknown",
      status: row.status || "completed",
    };
  }

  if (row.type === "complete") {
    return {
      type: "complete",
      riskLevel: row.status || "cannot_verify",
    };
  }

  if (row.type === "error") {
    return {
      type: "error",
      code: "CHECK_FAILED",
      message: "Check investigation encountered a failure",
    };
  }

  // Fallback safe progress event
  return {
    type: "stage",
    stage: row.type || "processing",
  };
}

/**
 * Asynchronously streams events from database with bus wake-ups, polling fallback, and keepalives.
 *
 * @param {object} options
 * @param {string} options.checkId
 * @param {number|null} [options.lastEventId]
 * @param {import("better-sqlite3").Database} options.db
 * @param {object} options.bus
 * @param {() => number} [options.now]
 * @param {number} [options.heartbeatMs=15000]
 * @param {number} [options.maxDurationMs=300000]
 * @param {number} [options.pollMs=1000]
 * @param {AbortSignal} [options.signal]
 * @returns {AsyncGenerator<string, void, unknown>}
 */
export async function* streamEvents(options) {
  const {
    checkId,
    db,
    bus,
    signal,
  } = options;

  let currentLastSeq = options.lastEventId ?? 0;
  const nowFn = options.now || (() => Date.now());
  const heartbeatMs = options.heartbeatMs ?? 15000;
  const maxDurationMs = options.maxDurationMs ?? 300000;
  const pollMs = options.pollMs ?? 1000;

  const startTime = nowFn();
  let lastHeartbeatTime = startTime;

  // Wake-up trigger queue with pending flag to avoid lost notifications
  let wakeResolve = null;
  let wakePending = false;
  const onWake = () => {
    if (wakeResolve) {
      const fn = wakeResolve;
      wakeResolve = null;
      fn();
    } else {
      wakePending = true;
    }
  };

  const unsubscribe = bus.subscribe(checkId, onWake);

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const now = nowFn();
      if (now - startTime >= maxDurationMs) {
        break;
      }

      // Reset pending flag as we are about to read
      wakePending = false;

      // 1. Fetch new events from database with seq > currentLastSeq
      let events = [];
      try {
        events = listEventsAfter(checkId, currentLastSeq, db);
      } catch (err) {
        // Database failure: emit safe terminal error frame and close
        yield formatEvent({
          event: "message",
          data: { type: "error", code: "INTERNAL_ERROR", message: "Database read error" },
        });
        break;
      }

      let sawTerminal = false;

      for (const event of events) {
        currentLastSeq = event.seq;

        yield formatEvent({
          id: event.seq,
          event: "message",
          data: event,
        });

        if (event.type === "complete" || event.type === "error") {
          sawTerminal = true;
          break;
        }
      }

      if (sawTerminal) {
        break;
      }

      // Check if check has reached terminal status in checks table
      try {
        const check = getCheck(checkId, db);
        if (check && check.status === "failed") {
          if (events.length === 0) {
            yield formatEvent({
              id: currentLastSeq,
              event: "message",
              data: {
                type: "error",
                code: "CHECK_FAILED",
                message: "Check investigation encountered a failure",
              },
            });
            break;
          }
        } else if (check && check.status === "report_ready") {
          // If all events were emitted and check is in terminal status, finish
          if (events.length === 0) {
            break;
          }
        }
      } catch (_e) {}

      // 2. Check if keepalive ping is needed
      if (nowFn() - lastHeartbeatTime >= heartbeatMs) {
        yield formatComment("ping");
        lastHeartbeatTime = nowFn();
      }

      // If a wake was signaled while we were processing rows, re-read immediately without waiting
      if (wakePending) {
        continue;
      }

      // 3. Wait for bus notification, polling timeout, abort signal, or heartbeat/maxDuration deadline
      const remainingHeartbeat = Math.max(1, heartbeatMs - (nowFn() - lastHeartbeatTime));
      const remainingDuration = Math.max(1, maxDurationMs - (nowFn() - startTime));
      const waitTimeoutMs = Math.min(pollMs, remainingHeartbeat, remainingDuration);

      await new Promise((resolve) => {
        let timer = null;
        const onAbort = () => {
          if (timer) clearTimeout(timer);
          resolve();
        };

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        wakeResolve = () => {
          if (timer) clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve();
        };

        timer = setTimeout(() => {
          wakeResolve = null;
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve();
        }, waitTimeoutMs);
      });
    }
  } finally {
    unsubscribe();
  }
}


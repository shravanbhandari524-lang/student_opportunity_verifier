/**
 * lib/client-logger.js
 *
 * Client-side logging utility that persists live investigation progress,
 * SSE frames, tool executions, and agent results to browser localStorage.
 * Allows developers and users to view real-time logs in the UI without
 * needing terminal access.
 */

const STORAGE_KEY = "opportunity_verifier_debug_logs";
const MAX_LOGS = 600;

/**
 * Records a debug log entry into browser localStorage.
 * Capped at MAX_LOGS to prevent exceeding storage quotas.
 * Dispatches a 'debug_logs_updated' custom event for real-time tab syncing.
 *
 * @param {object} entry
 */
export function recordClientLog(entry) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const logs = raw ? JSON.parse(raw) : [];
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    logs.unshift(item);
    if (logs.length > MAX_LOGS) {
      logs.length = MAX_LOGS;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    window.dispatchEvent(new CustomEvent("debug_logs_updated", { detail: item }));
  } catch (_e) {
    // Gracefully tolerate QuotaExceededError or disabled localStorage
  }
}

/**
 * Retrieves all debug log entries from localStorage.
 * @returns {Array<object>}
 */
export function getClientLogs() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clears all debug logs from localStorage.
 */
export function clearClientLogs() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("debug_logs_updated", { detail: null }));
  } catch (_e) {}
}

/**
 * Persists the most recent check ID for navigation switching.
 * @param {string} checkId
 */
export function setLastActiveCheckId(checkId) {
  if (typeof window === "undefined" || !window.localStorage || !checkId) return;
  try {
    window.localStorage.setItem("sov_last_check_id", checkId);
    window.dispatchEvent(new CustomEvent("debug_logs_updated"));
  } catch (_e) {}
}

/**
 * Returns the latest active check ID or discovers it from logs.
 * @returns {string | null}
 */
export function getLastActiveCheckId() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const direct = window.localStorage.getItem("sov_last_check_id");
    if (direct) return direct;
    const logs = getClientLogs();
    for (const log of logs) {
      if (log.checkId) return log.checkId;
    }
  } catch (_e) {}
  return null;
}


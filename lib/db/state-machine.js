import { CHECK_STATUSES } from "../contracts/enums.js";

export { CHECK_STATUSES };

/**
 * State machine transitions per ARCHITECTURE.md and docs/contracts.md section 2.
 * - created -> extracting, failed
 * - extracting -> awaiting_confirmation, failed
 * - awaiting_confirmation -> investigating, failed
 * - investigating -> scoring, failed
 * - scoring -> report_ready, failed
 * - report_ready -> (terminal, no transitions)
 * - failed -> (terminal, no transitions)
 */
export const ALLOWED_TRANSITIONS = Object.freeze({
  created: Object.freeze(["extracting", "failed"]),
  extracting: Object.freeze(["awaiting_confirmation", "failed"]),
  awaiting_confirmation: Object.freeze(["investigating", "failed"]),
  investigating: Object.freeze(["scoring", "failed"]),
  scoring: Object.freeze(["report_ready", "failed"]),
  report_ready: Object.freeze([]),
  failed: Object.freeze([]),
});

/**
 * Validates whether transition from fromStatus to toStatus is valid.
 * @param {string} fromStatus
 * @param {string} toStatus
 * @returns {boolean}
 */
export function canTransition(fromStatus, toStatus) {
  if (!CHECK_STATUSES.includes(fromStatus) || !CHECK_STATUSES.includes(toStatus)) {
    return false;
  }
  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

/**
 * Asserts that transition is valid, throwing an Error with clear explanation if not.
 * @param {string} fromStatus
 * @param {string} toStatus
 */
export function assertTransition(fromStatus, toStatus) {
  if (!CHECK_STATUSES.includes(fromStatus)) {
    throw new Error(`Invalid source status: '${fromStatus}'`);
  }
  if (!CHECK_STATUSES.includes(toStatus)) {
    throw new Error(`Invalid target status: '${toStatus}'`);
  }
  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new Error(
      `Invalid state transition from '${fromStatus}' to '${toStatus}'. Allowed: [${allowed.join(", ")}]`
    );
  }
}

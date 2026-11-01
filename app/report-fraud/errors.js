/**
 * Error-code to user-safe message mapping for the fraud report & complaint assistant.
 * Prevents leaking technical backend errors or echoing untrusted inputs.
 */
export function getReportFraudErrorMessage({ status, code, message } = {}) {
  if (status === 410 || code === "CHECK_EXPIRED") {
    return "This verification check has expired (reports expire after 24 hours). You can generate a standalone complaint draft without check evidence below.";
  }
  if (status === 429 || code === "RATE_LIMITED") {
    return "Too many requests. Please wait a few moments before requesting another summary.";
  }
  if (status === 404 || code === "NOT_FOUND") {
    return "Verification check not found. You can switch to standalone mode below.";
  }
  if (status === 409 || code === "STATE_CONFLICT") {
    return "The check investigation has not finished yet. Wait for report readiness or switch to standalone mode.";
  }
  return message || "Unable to generate complaint summary. Please check your inputs.";
}

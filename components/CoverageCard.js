"use client";

const SIGNAL_NAMES = {
  message: "Message & Offer Text",
  payee: "Payment & UPI Identity",
  website: "Domain & Web Forensics",
  official: "Official Government & Corporate Registry",
  reputation: "Community & OSINT Complaints",
};

export default function CoverageCard({ coverage, improveCheck = [] }) {
  if (!coverage) return null;

  const checked = Array.isArray(coverage.checked) ? coverage.checked : [];
  const notChecked = Array.isArray(coverage.notChecked) ? coverage.notChecked : [];

  return (
    <section className="panel" aria-labelledby="coverage-heading">
      <div className="panel-header">
        <div>
          <h2 id="coverage-heading" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
            Evidence Coverage
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            The 5 independent verification vectors required to establish high-confidence safety.
          </p>
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            fontWeight: 600,
            padding: "3px 8px",
            backgroundColor: "var(--bg-muted)",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {checked.length} / 5 Signals
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
        {/* Checked Signals */}
        <div>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--status-emerald)", letterSpacing: "0.04em", display: "block", marginBottom: "6px" }}>
            ✓ Verified Signals ({checked.length})
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {checked.length > 0 ? (
              checked.map((s, idx) => {
                const label = typeof s === "string" ? (SIGNAL_NAMES[s] || s) : (s.name || s.label || JSON.stringify(s));
                const detail = typeof s === "object" ? s.detail : null;
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 8px",
                      backgroundColor: "var(--status-emerald-bg)",
                      border: "1px solid var(--status-emerald-border)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "12px",
                      color: "var(--status-emerald-text)",
                    }}
                  >
                    <span>✓</span>
                    <span>{label}</span>
                    {detail ? <span style={{ opacity: 0.8, fontSize: "11px" }}>({detail})</span> : null}
                  </div>
                );
              })
            ) : (
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
                No signals could be confirmed.
              </span>
            )}
          </div>
        </div>

        {/* Not Checked Signals */}
        <div>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.04em", display: "block", marginBottom: "6px" }}>
            ⊘ Not Checked / Missing Inputs ({notChecked.length})
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {notChecked.length > 0 ? (
              notChecked.map((s, idx) => {
                const label = typeof s === "string" ? (SIGNAL_NAMES[s] || s) : (s.name || s.label || JSON.stringify(s));
                const reason = typeof s === "object" ? s.reason : null;
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 8px",
                      backgroundColor: "var(--bg-muted)",
                      border: "1px solid var(--border-primary)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "12px",
                      color: "var(--text-muted)",
                    }}
                  >
                    <span>⊘</span>
                    <span>{label}</span>
                    {reason ? <span style={{ opacity: 0.8, fontSize: "11px" }}>({reason})</span> : null}
                  </div>
                );
              })
            ) : (
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
                All 5 signal types were examined.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actionable Suggestions: How to strengthen the check */}
      {Array.isArray(improveCheck) && improveCheck.length > 0 && (
        <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-divider)" }}>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--text-primary)", letterSpacing: "0.04em", display: "block", marginBottom: "4px" }}>
            Strengthen this check:
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {improveCheck.map((hint, idx) => (
              <span
                key={idx}
                style={{
                  fontSize: "12px",
                  padding: "3px 8px",
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-secondary)",
                }}
              >
                + {hint}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

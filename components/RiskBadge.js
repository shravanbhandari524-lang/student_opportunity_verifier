"use client";

export default function RiskBadge({ level, score, confidence, rulesFired = [] }) {
  const normLevel = (level || "cannot_verify").toLowerCase();

  const LEVEL_CONFIG = {
    high: {
      label: "HIGH RISK",
      badgeClass: "badge-high",
      dotClass: "crimson",
      color: "var(--status-crimson)",
      headline: "Critical Warning Signs Detected",
      subtext: "Multiple unverified claims or predatory fee demands were identified.",
    },
    medium: {
      label: "MEDIUM RISK",
      badgeClass: "badge-medium",
      dotClass: "amber",
      color: "var(--status-amber)",
      headline: "Caution: Verification Gaps Present",
      subtext: "Some warning signals require direct offline confirmation with the institution.",
    },
    low: {
      label: "LOW RISK",
      badgeClass: "badge-low",
      dotClass: "emerald",
      color: "var(--status-emerald)",
      headline: "Positive Verification Signals",
      subtext: "Channels match established public registries. Continue prudent verification.",
    },
    cannot_verify: {
      label: "CANNOT VERIFY",
      badgeClass: "badge-cannot_verify",
      dotClass: "neutral",
      color: "var(--status-neutral)",
      headline: "Insufficient Public Evidence",
      subtext: "Fewer than 2 signal types were available to establish authenticity.",
    },
  };

  const cfg = LEVEL_CONFIG[normLevel] || LEVEL_CONFIG.cannot_verify;
  const numScore = typeof score === "number" ? Math.max(0, Math.min(100, Math.round(score))) : null;

  return (
    <div
      className="panel"
      style={{
        borderLeft: `4px solid ${cfg.color}`,
        backgroundColor: "var(--bg-surface)",
      }}
      role="region"
      aria-label="Risk Assessment Verdict"
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span className={`status-dot ${cfg.dotClass}`} aria-hidden="true" style={{ width: "8px", height: "8px" }} />
          <span className={`badge ${cfg.badgeClass}`} style={{ fontSize: "12px", padding: "3px 10px" }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase" }}>
            (Assessed Risk Level)
          </span>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            · Confidence: <strong style={{ color: "var(--text-primary)" }}>{confidence || "Medium"}</strong>
          </span>
        </div>

        {numScore !== null && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 600 }}>
            <span>Score: </span>
            <span style={{ color: cfg.color }}>{numScore}</span>
            <span style={{ color: "var(--text-muted)" }}> / 100 Risk</span>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {numScore !== null && (
        <div
          style={{
            height: "6px",
            backgroundColor: "var(--bg-muted)",
            borderRadius: "var(--radius-full)",
            overflow: "hidden",
            margin: "0.75rem 0",
          }}
          aria-hidden="true"
        >
          <div
            style={{
              height: "100%",
              width: `${numScore}%`,
              backgroundColor: cfg.color,
              transition: "width 300ms ease",
            }}
          />
        </div>
      )}

      {/* Headline & Description */}
      <h2 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", marginTop: "0.35rem" }}>
        {cfg.headline}
      </h2>
      <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "0.25rem", lineHeight: 1.5 }}>
        {cfg.subtext}
      </p>

      {/* Rules that fired */}
      {Array.isArray(rulesFired) && rulesFired.length > 0 && (
        <div style={{ marginTop: "0.85rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-divider)" }}>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.04em" }}>
            Decision Rules Applied:
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
            {rulesFired.map((rule, idx) => (
              <span
                key={idx}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  padding: "2px 6px",
                  backgroundColor: "var(--bg-muted)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-secondary)",
                }}
              >
                {rule}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

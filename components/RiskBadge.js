"use client";

export default function RiskBadge({ level, score, confidence, rulesFired = [] }) {
  const normLevel = (level || "cannot_verify").toLowerCase();

  const LEVEL_CONFIG = {
    high: {
      label: "HIGH RISK",
      badgeClass: "badge-high",
      dotClass: "crimson",
      color: "var(--status-crimson)",
      bg: "var(--status-crimson-bg)",
      border: "var(--status-crimson-border)",
      headline: "Critical Warning Signs Detected",
      subtext: "Multiple unverified claims or predatory fee demands were identified.",
    },
    medium: {
      label: "MEDIUM RISK",
      badgeClass: "badge-medium",
      dotClass: "amber",
      color: "var(--status-amber)",
      bg: "var(--status-amber-bg)",
      border: "var(--status-amber-border)",
      headline: "Caution: Verification Gaps Present",
      subtext: "Some warning signals require direct offline confirmation with the institution.",
    },
    low: {
      label: "LOW RISK",
      badgeClass: "badge-low",
      dotClass: "emerald",
      color: "var(--status-emerald)",
      bg: "var(--status-emerald-bg)",
      border: "var(--status-emerald-border)",
      headline: "Positive Verification Signals",
      subtext: "Channels match established public registries. Continue prudent verification.",
    },
    cannot_verify: {
      label: "CANNOT VERIFY",
      badgeClass: "badge-cannot_verify",
      dotClass: "neutral",
      color: "var(--status-neutral)",
      bg: "var(--status-neutral-bg)",
      border: "var(--status-neutral-border)",
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
        boxShadow: "var(--shadow-sm)",
      }}
      role="region"
      aria-label="Risk Assessment Verdict"
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span className={`status-dot ${cfg.dotClass}`} aria-hidden="true" style={{ width: "8px", height: "8px" }} />
          <span className={`badge ${cfg.badgeClass}`} style={{ fontSize: "11px", padding: "4px 10px", fontWeight: 700 }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            (Assessed Risk Level)
          </span>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            · Confidence: <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{confidence || "Medium"}</strong>
          </span>
        </div>

        {numScore !== null && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "var(--text-muted)" }}>Score: </span>
            <span style={{ color: cfg.color, fontSize: "15px", fontWeight: 700 }}>{numScore}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}> / 100 Risk</span>
          </div>
        )}
      </div>

      {/* Progress Bar (Smooth Apple Metric Meter) */}
      {numScore !== null && (
        <div
          style={{
            height: "7px",
            backgroundColor: "var(--bg-muted)",
            borderRadius: "var(--radius-full)",
            overflow: "hidden",
            margin: "0.75rem 0 1rem 0",
          }}
          aria-hidden="true"
        >
          <div
            style={{
              height: "100%",
              width: `${numScore}%`,
              backgroundColor: cfg.color,
              borderRadius: "var(--radius-full)",
              transition: "width 400ms var(--ease-out)",
            }}
          />
        </div>
      )}

      {/* Headline & Description */}
      <h2 style={{ fontSize: "19px", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.025em" }}>
        {cfg.headline}
      </h2>
      <p style={{ fontSize: "13.5px", color: "var(--text-secondary)", marginTop: "0.3rem", lineHeight: 1.55 }}>
        {cfg.subtext}
      </p>

      {/* Rules that fired */}
      {Array.isArray(rulesFired) && rulesFired.length > 0 && (
        <div style={{ marginTop: "1rem", paddingTop: "0.85rem", borderTop: "1px solid var(--border-divider)" }}>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
            Decision Rules Applied:
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
            {rulesFired.map((rule, idx) => (
              <span
                key={idx}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  padding: "2px 7px",
                  backgroundColor: "var(--bg-subtle)",
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

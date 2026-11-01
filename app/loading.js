import Link from "next/link";

/**
 * Global Loading State
 * Accessible, responsive fallback indicator for route transitions.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        maxWidth: "500px",
        margin: "4rem auto",
        padding: "2rem 1.5rem",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.25rem",
      }}
    >
      <div
        style={{
          width: "42px",
          height: "42px",
          borderRadius: "50%",
          border: "3px solid var(--border-subtle, #e2e8f0)",
          borderTopColor: "var(--accent-primary, #0284c7)",
          animation: "spin 0.8s linear infinite",
        }}
        aria-hidden="true"
      />

      <div>
        <p
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: "0 0 0.35rem 0",
          }}
        >
          Loading verification details...
        </p>
        <span
          style={{
            fontSize: "0.85rem",
            color: "var(--text-muted)",
          }}
        >
          Connecting to opportunity verification services
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginTop: "1.5rem",
          fontSize: "0.85rem",
        }}
      >
        <Link
          href="/check"
          style={{
            color: "var(--accent-primary)",
            textDecoration: "underline",
          }}
        >
          Check an Offer
        </Link>
        <span style={{ color: "var(--text-muted)" }}>•</span>
        <Link
          href="/"
          style={{
            color: "var(--text-muted)",
            textDecoration: "underline",
          }}
        >
          Home
        </Link>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

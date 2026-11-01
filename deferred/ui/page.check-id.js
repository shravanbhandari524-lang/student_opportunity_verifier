import Link from "next/link";
import { getCheck } from "@/lib/db/index.js";

export default async function CheckStatusPage({ params }) {
  const { id } = await params;
  const check = getCheck(id);

  if (!check) {
    return (
      <div className="card" style={{ maxWidth: "600px", margin: "2rem auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Check Not Found
        </h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem" }}>
          The requested check ID could not be found or has expired (checks expire after 24 hours).
        </p>
        <Link href="/check" className="btn-primary">
          Start a new check
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div>
        <div
          style={{
            display: "inline-block",
            fontSize: "0.85rem",
            color: "var(--accent-primary)",
            fontWeight: 600,
            marginBottom: "0.25rem",
          }}
        >
          Check ID: {check.id}
        </div>
        <h1 style={{ fontSize: "1.85rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
          Opportunity Investigation
        </h1>
        <p style={{ color: "var(--text-secondary)" }}>
          Current status: <strong style={{ color: "var(--text-primary)" }}>{check.status}</strong>
        </p>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600 }}>Check Details</h2>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "0.5rem", fontSize: "0.95rem" }}>
          <span style={{ color: "var(--text-muted)" }}>Status:</span>
          <span>
            <span
              style={{
                display: "inline-block",
                padding: "0.2rem 0.6rem",
                borderRadius: "var(--radius-sm)",
                background: "var(--accent-light)",
                color: "var(--accent-primary)",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              {check.status}
            </span>
          </span>

          <span style={{ color: "var(--text-muted)" }}>Created at:</span>
          <span>{new Date(check.created_at).toLocaleString()}</span>

          <span style={{ color: "var(--text-muted)" }}>Expires at:</span>
          <span>{new Date(check.expires_at).toLocaleString()}</span>

          <span style={{ color: "var(--text-muted)" }}>Language:</span>
          <span>{check.language}</span>
        </div>

        <div
          style={{
            marginTop: "1rem",
            padding: "1rem",
            background: "var(--bg-subtle)",
            borderRadius: "var(--radius-sm)",
            fontSize: "0.9rem",
            color: "var(--text-secondary)",
          }}
        >
          <em>
            Note: Pipeline extraction and agents will be integrated in subsequent layers (L1–L6). In this foundation layer, the check status machine and database record are active.
          </em>
        </div>

        <div style={{ marginTop: "0.5rem" }}>
          <Link href="/check" className="btn-secondary" style={{ fontSize: "0.9rem", padding: "0.5rem 1rem" }}>
            ← Submit another check
          </Link>
        </div>
      </div>
    </div>
  );
}

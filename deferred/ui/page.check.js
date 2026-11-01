"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CheckPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [consent, setConsent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Please paste the message or offer details to verify.");
      return;
    }
    if (!consent) {
      setError("Please acknowledge that this is a risk assessment and not a legal verdict.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: "en" }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit check");
      }

      router.push(`/check/${data.checkId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
          Check an Opportunity
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem" }}>
          Paste the scholarship, job offer, or message you received below to initiate verification.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {error && (
          <div
            style={{
              padding: "0.75rem 1rem",
              background: "var(--risk-high-bg)",
              color: "var(--risk-high)",
              borderRadius: "var(--radius-sm)",
              fontSize: "0.9rem",
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label htmlFor="offer-text" style={{ fontWeight: 600, fontSize: "0.95rem" }}>
            Offer message or details:
          </label>
          <textarea
            id="offer-text"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste WhatsApp message, email body, job description, or payment instructions..."
            style={{
              width: "100%",
              padding: "0.85rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-subtle)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: "0.95rem",
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
          <input
            type="checkbox"
            id="consent"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{ marginTop: "0.25rem", cursor: "pointer" }}
          />
          <label htmlFor="consent" style={{ fontSize: "0.85rem", color: "var(--text-secondary)", cursor: "pointer" }}>
            I understand this tool produces an automated risk assessment using public facts and evidence, not a legal verdict.
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
          style={{ width: "100%", opacity: loading ? 0.7 : 1 }}
        >
          {loading ? "Submitting Check..." : "Start Verification →"}
        </button>
      </form>
    </div>
  );
}

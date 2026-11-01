"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordClientLog } from "../../lib/client-logger.js";

const SAMPLE_OFFERS = [
  {
    label: "Fake Internship (TechCorp)",
    text: "Congratulations! You have been shortlisted for a 3-month remote Software Developer Internship at TechCorp India. Monthly stipend is ₹35,000. To confirm your seat and receive the training toolkit, pay a refundable security deposit of ₹3,500 to our HR coordinator upi: hr-techcorp@oksbi. Official site: http://techcorp-internship-careers.xyz",
    upiId: "hr-techcorp@oksbi",
    url: "http://techcorp-internship-careers.xyz",
    company: "TechCorp India",
  },
  {
    label: "Telegram Task Job",
    text: "Dear student, earn ₹3000 to ₹5000 daily working from home! Just subscribe to YouTube channels and like videos. 100% legal part-time opportunity. Contact our Telegram manager @task_payouts_daily to start your first trial task.",
    handle: "@task_payouts_daily",
    company: "Global Media Promotions",
  },
  {
    label: "Scholarship Fee Scheme",
    text: "National Merit Scholarship Alert 2026: You are eligible to receive ₹50,000 direct scholarship under PM Yuva Scholarship scheme. Complete document verification at http://pm-yuva-scholarship-gov.in-portal.org and submit application processing fee of ₹499.",
    url: "http://pm-yuva-scholarship-gov.in-portal.org",
  },
];

export default function CheckPage() {
  const router = useRouter();

  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [upiId, setUpiId] = useState("");
  const [company, setCompany] = useState("");
  const [handle, setHandle] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("en");
  const [consent, setConsent] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function applySample(sample) {
    setText(sample.text || "");
    setUrl(sample.url || "");
    setUpiId(sample.upiId || "");
    setCompany(sample.company || "");
    setHandle(sample.handle || "");
    setConsent(true);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!text.trim() && !url.trim() && !selectedFile) {
      setError("Please provide offer message text, a website link, or upload a screenshot to verify.");
      return;
    }

    if (!consent) {
      setError("Please acknowledge that this is a risk assessment and not a legal verdict.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      if (text.trim()) formData.append("text", text.trim());
      if (url.trim()) formData.append("url", url.trim());
      if (upiId.trim()) formData.append("upiId", upiId.trim());
      if (company.trim()) formData.append("company", company.trim());
      if (handle.trim()) formData.append("handle", handle.trim());
      if (phone.trim()) formData.append("phone", phone.trim());
      formData.append("language", language);
      formData.append("consent", "true");

      if (selectedFile) {
        formData.append("images", selectedFile, selectedFile.name);
      }

      const res = await fetch("/api/checks", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || data.message || "Failed to submit check. Please try again.");
      }

      const checkId = data.checkId || data.id;
      if (!checkId) {
        throw new Error("Missing check ID in server response");
      }

      recordClientLog({
        checkId,
        type: "check_created",
        agent: "client",
        summary: `Created check ${checkId.slice(0, 8)}... (language: ${language})`,
      });

      router.push(`/check/${checkId}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: "740px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div>
        <h1 style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
          Verify an Opportunity
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "0.35rem", fontSize: "0.98rem" }}>
          Paste the scholarship, job offer, or message you received below to initiate automated multi-agent fact checking.
        </p>
      </div>

      {/* Quick Test Samples */}
      <div className="card-subtle" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
          Quick Demo: Test with a sample suspicious offer
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {SAMPLE_OFFERS.map((s) => (
            <button
              key={s.label}
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => applySample(s)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {error && (
          <div
            style={{
              padding: "0.8rem 1rem",
              backgroundColor: "var(--risk-high-bg)",
              color: "var(--risk-high)",
              border: "1px solid var(--risk-high-border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "0.9rem",
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}

        {/* Message Text Input */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <label htmlFor="offer-text" style={{ fontWeight: 600, fontSize: "0.95rem" }}>
            Offer message or details:
          </label>
          <textarea
            id="offer-text"
            className="input-textarea"
            placeholder="Paste the WhatsApp message, job email, SMS or Telegram invitation here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {/* Screenshot Upload */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <label htmlFor="offer-file" style={{ fontWeight: 600, fontSize: "0.95rem" }}>
            Screenshot or document image (optional):
          </label>
          <input
            id="offer-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="input-text"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                setSelectedFile(e.target.files[0]);
              } else {
                setSelectedFile(null);
              }
            }}
          />
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            PNG, JPEG, WebP up to 5MB. In compliance with DPDP Act, images are automatically deleted immediately after extraction.
          </span>
        </div>

        {/* Toggle Additional Fields */}
        <div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            <span>{showAdvanced ? "▲ Hide specific identifiers" : "▼ Add specific identifiers (UPI, URL, Company, Phone)"}</span>
          </button>
        </div>

        {showAdvanced && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
              padding: "1rem",
              backgroundColor: "var(--bg-card-subtle)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label htmlFor="field-url" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                Website or Link URL:
              </label>
              <input
                id="field-url"
                type="text"
                placeholder="https://..."
                className="input-text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label htmlFor="field-upi" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                UPI ID (VPA):
              </label>
              <input
                id="field-upi"
                type="text"
                placeholder="name@okhdfcbank"
                className="input-text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label htmlFor="field-company" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                Claimed Company:
              </label>
              <input
                id="field-company"
                type="text"
                placeholder="e.g. Infosys, TCS"
                className="input-text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label htmlFor="field-handle" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                Telegram / Instagram Handle:
              </label>
              <input
                id="field-handle"
                type="text"
                placeholder="@username"
                className="input-text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label htmlFor="field-phone" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                Contact Phone:
              </label>
              <input
                id="field-phone"
                type="text"
                placeholder="+91..."
                className="input-text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label htmlFor="field-language" style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                Report Language:
              </label>
              <select
                id="field-language"
                className="input-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="en">English</option>
                <option value="hi">हिंदी (Hindi)</option>
              </select>
            </div>
          </div>
        )}

        {/* Consent Checkbox (Strictly required per PRD) */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginTop: "0.5rem" }}>
          <input
            id="consent-checkbox"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{ marginTop: "0.25rem", cursor: "pointer", width: "16px", height: "16px" }}
          />
          <label htmlFor="consent-checkbox" style={{ fontSize: "0.88rem", color: "var(--text-secondary)", cursor: "pointer" }}>
            I understand that this tool generates an automated risk assessment based on publicly verifiable evidence. It is intended for student guidance and does not constitute a legal verdict.
          </label>
        </div>

        {/* Submit Button */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ padding: "0.75rem 1.75rem" }}
          >
            {loading ? (
              <>
                <span className="spinner" />
                <span>Starting Investigation...</span>
              </>
            ) : (
              <span>Start Investigation →</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

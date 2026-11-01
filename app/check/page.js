"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HANDLE_PLATFORMS } from "../../lib/contracts/enums.js";

const SAMPLE_OFFERS = [
  {
    label: "Fake Internship (TechCorp)",
    text: "Congratulations! You have been shortlisted for a 3-month remote Software Developer Internship at TechCorp India. Monthly stipend is ₹35,000. To confirm your seat and receive the training toolkit, pay a refundable security deposit of ₹3,500 to our HR coordinator upi: hr-techcorp@oksbi. Official site: http://techcorp-internship-careers.xyz",
    upiId: "hr-techcorp@oksbi",
    url: "http://techcorp-internship-careers.xyz",
    company: "TechCorp India",
    userNotes: "Received via an unsolicited email from a free outlook address.",
  },
  {
    label: "Telegram Task Job",
    text: "Dear student, earn ₹3000 to ₹5000 daily working from home! Just subscribe to YouTube channels and like videos. 100% legal part-time opportunity. Contact our Telegram manager @task_payouts_daily to start your first trial task.",
    handle: "@task_payouts_daily",
    handlePlatform: "telegram",
    company: "Global Media Promotions",
    userNotes: "They added me to a random group with 2,000 members sharing screenshots of payouts.",
  },
  {
    label: "PM Yuva Scholarship Scheme",
    text: "National Merit Scholarship Alert 2026: You are eligible to receive ₹50,000 direct scholarship under PM Yuva Scholarship scheme. Complete document verification at http://pm-yuva-scholarship-gov.in-portal.org and submit application processing fee of ₹499.",
    url: "http://pm-yuva-scholarship-gov.in-portal.org",
    company: "Ministry of Education Scheme",
    userNotes: "Came as an SMS to my father's phone asking to pay processing fee immediately.",
  },
];

export default function CheckPage() {
  const router = useRouter();

  const [text, setText] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [url, setUrl] = useState("");
  const [upiId, setUpiId] = useState("");
  const [company, setCompany] = useState("");
  const [handle, setHandle] = useState("");
  const [handlePlatform, setHandlePlatform] = useState("");
  const [phone, setPhone] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [language, setLanguage] = useState("en");
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState([]);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function applySample(sample) {
    setText(sample.text || "");
    setUserNotes(sample.userNotes || "");
    setUrl(sample.url || "");
    setUpiId(sample.upiId || "");
    setCompany(sample.company || "");
    setHandle(sample.handle || "");
    setHandlePlatform(sample.handlePlatform || "");
    setPhone(sample.phone || "");
    setYoutubeUrl(sample.youtubeUrl || "");
    setConsent(true);
    setError(null);
  }

  function handleFileChange(e) {
    const selected = Array.from(e.target.files || []);
    if (files.length + selected.length > 5) {
      setError("Maximum 5 screenshots allowed.");
      return;
    }

    for (const f of selected) {
      if (f.size > 5 * 1024 * 1024) {
        setError(`File ${f.name} exceeds the 5 MB limit.`);
        return;
      }
      if (!["image/png", "image/jpeg", "image/jpg"].includes(f.type)) {
        setError(`File ${f.name} must be PNG or JPG format.`);
        return;
      }
    }

    setFiles((prev) => [...prev, ...selected].slice(0, 5));
    setError(null);
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    // Client-side validation: at least text, file, or url required
    const hasText = text.trim().length > 0;
    const hasFiles = files.length > 0;
    const hasUrl = url.trim().length > 0;

    if (!hasText && !hasFiles && !hasUrl) {
      setError("Please provide at least one primary input: paste message text, upload an image, or enter a website URL.");
      return;
    }

    if (!consent) {
      setError("Please check the consent box acknowledging that this is a risk assessment, not a legal verdict.");
      return;
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      if (hasText) formData.append("text", text.trim());
      if (userNotes.trim()) formData.append("userNotes", userNotes.trim());
      if (hasUrl) formData.append("url", url.trim());
      if (upiId.trim()) formData.append("upiId", upiId.trim());
      if (company.trim()) formData.append("company", company.trim());
      if (handle.trim()) formData.append("handle", handle.trim());
      if (handlePlatform.trim()) formData.append("handlePlatform", handlePlatform.trim());
      if (phone.trim()) formData.append("phone", phone.trim());
      if (youtubeUrl.trim()) formData.append("youtubeUrl", youtubeUrl.trim());
      formData.append("language", language);
      formData.append("consent", "true");

      for (const f of files) {
        formData.append("images", f);
      }

      const res = await fetch("/api/checks", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Check creation failed with status ${res.status}`);
      }

      const data = await res.json();
      const checkId = data.checkId;

      // Save to local device history
      try {
        const raw = localStorage.getItem("ov_recent_checks");
        const prev = raw ? JSON.parse(raw) : [];
        const entry = {
          id: checkId,
          timestamp: new Date().toISOString(),
          summary: company || url || upiId || (text ? text.slice(0, 40) : "New check"),
          riskLevel: "unknown",
        };
        const updated = [entry, ...prev.filter((p) => p.id !== checkId)].slice(0, 10);
        localStorage.setItem("ov_recent_checks", JSON.stringify(updated));
      } catch {}

      router.push(`/check/${checkId}`);
    } catch (err) {
      setError(err.message || "An unexpected error occurred during submission.");
      setSubmitting(false);
    }
  }

  return (
    <div className="container-narrow" style={{ padding: "2rem 1rem 4rem 1rem" }}>
      {/* Title */}
      <div style={{ marginBottom: "1.75rem" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          New Opportunity Check
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "4px" }}>
          Paste an offer transcript, upload screenshot evidence, or submit payment handles for multi-agent forensic verification.
        </p>
      </div>

      {/* Preset Pills */}
      <div className="panel-subtle" style={{ marginBottom: "1.75rem", padding: "1rem" }}>
        <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "6px" }}>
          Try a Test Case / Demo Scenario:
        </span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {SAMPLE_OFFERS.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => applySample(s)}
              className="btn btn-secondary btn-sm"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Submission Form */}
      <form onSubmit={handleSubmit} className="panel" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        {/* Primary Input 1: Message Text */}
        <div className="form-group" style={{ margin: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label htmlFor="check-text" className="form-label">
              Offer Letter / Message Transcript:
            </label>
            <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              {text.length} / 10,000
            </span>
          </div>
          <textarea
            id="check-text"
            rows={5}
            maxLength={10000}
            placeholder="Paste WhatsApp messages, email text, SMS notices, or job offer letters here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input-field"
          />
        </div>

        {/* Primary Input 2: Screenshots (Vision Extraction) */}
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">
            Upload Chat Screenshots / Offer PDFs (Up to 5 images, max 5 MB each):
          </label>
          <input
            type="file"
            id="check-files"
            multiple
            accept="image/png, image/jpeg, image/jpg"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <label htmlFor="check-files" className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
              📎 Choose images
            </label>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              {files.length > 0 ? `${files.length} image(s) selected` : "No files chosen (optional)"}
            </span>
          </div>

          {/* Thumbnails */}
          {files.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" }}>
              {files.map((file, idx) => (
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
                  }}
                >
                  <span style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: "0 4px", color: "var(--status-crimson)" }}
                    aria-label={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Optional Other Context (userNotes) - Required by PRD */}
        <div className="form-group" style={{ margin: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label htmlFor="check-notes" className="form-label">
              Other Relevant Information (Optional):
            </label>
            <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              {userNotes.length} / 5,000
            </span>
          </div>
          <textarea
            id="check-notes"
            rows={2}
            maxLength={5000}
            placeholder="Add any extra context (e.g. 'They contacted me on Telegram first', 'Recruiter requested payment via personal QR code')..."
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            className="input-field"
          />
        </div>

        {/* Specific Identifier Fields (Accordion / Toggle) */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="btn btn-ghost btn-sm"
            style={{ paddingLeft: 0, color: "var(--text-secondary)", fontWeight: 600 }}
          >
            {showAdvanced ? "▾ Hide specific identifier fields" : "▸ Add specific link, UPI ID, handle, or company (Optional)"}
          </button>

          {showAdvanced && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "1rem",
                backgroundColor: "var(--bg-subtle)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-sm)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "10px",
              }}
            >
              <div>
                <label htmlFor="field-url" className="form-label" style={{ fontSize: "12px" }}>
                  Website / Offer Link:
                </label>
                <input
                  type="url"
                  id="field-url"
                  placeholder="https://company-careers.example"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="field-upi" className="form-label" style={{ fontSize: "12px" }}>
                  UPI ID / Payment VPA:
                </label>
                <input
                  type="text"
                  id="field-upi"
                  placeholder="e.g. hr-desk@okhdfc"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="field-company" className="form-label" style={{ fontSize: "12px" }}>
                  Claimed Company / Scheme:
                </label>
                <input
                  type="text"
                  id="field-company"
                  placeholder="e.g. Google India / PMSS"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="field-handle" className="form-label" style={{ fontSize: "12px" }}>
                  Social Handle / Manager Contact:
                </label>
                <div style={{ display: "flex", gap: "4px" }}>
                  <select
                    id="field-platform"
                    value={handlePlatform}
                    onChange={(e) => setHandlePlatform(e.target.value)}
                    className="input-field"
                    style={{ width: "95px" }}
                  >
                    <option value="">Platform</option>
                    {HANDLE_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    id="field-handle"
                    placeholder="@recruiter_jobs"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="field-phone" className="form-label" style={{ fontSize: "12px" }}>
                  Recruiter Phone Number:
                </label>
                <input
                  type="tel"
                  id="field-phone"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="field-youtube" className="form-label" style={{ fontSize: "12px" }}>
                  YouTube Video Link (Task gig check):
                </label>
                <input
                  type="url"
                  id="field-youtube"
                  placeholder="https://youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="input-field"
                />
              </div>
            </div>
          )}
        </div>

        {/* Report Language Preference */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <label htmlFor="pref-lang" className="form-label" style={{ fontSize: "13px", margin: 0 }}>
            Preferred Report Language:
          </label>
          <select
            id="pref-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="input-field"
            style={{ width: "auto" }}
          >
            <option value="en">English (default)</option>
            <option value="hi">Hindi (हिंदी)</option>
          </select>
        </div>

        {/* Mandatory Consent Checkbox (PRD §5) */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            padding: "10px 12px",
            backgroundColor: "var(--bg-subtle)",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <input
            type="checkbox"
            id="consent-check"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            style={{
              marginTop: "3px",
              cursor: "pointer",
              width: "15px",
              height: "15px",
              accentColor: "var(--accent-primary)",
            }}
          />
          <label htmlFor="consent-check" style={{ fontSize: "13px", color: "var(--text-primary)", cursor: "pointer", lineHeight: 1.45 }}>
            <strong>Consent &amp; Safety Acknowledgement:</strong> I understand that this tool performs an automated risk assessment based on publicly available data, not a legal verdict. No screenshot images or user chats are permanently stored.
          </label>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              padding: "10px 12px",
              backgroundColor: "var(--status-crimson-bg)",
              border: "1px solid var(--status-crimson-border)",
              color: "var(--status-crimson-text)",
              borderRadius: "var(--radius-sm)",
              fontSize: "13px",
              fontWeight: 500,
            }}
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Submit CTA */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", borderTop: "1px solid var(--border-divider)", paddingTop: "1rem" }}>
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary"
            style={{ padding: "10px 24px", fontSize: "14px", fontWeight: 600 }}
          >
            {submitting ? (
              <>
                <span className="spinner" />
                <span>Extracting details...</span>
              </>
            ) : (
              <>
                <span>Submit and Review Extraction</span>
                <span aria-hidden="true">→</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

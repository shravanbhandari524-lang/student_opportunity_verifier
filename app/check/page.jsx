"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Card from "../../components/ui/Card.jsx";
import { Input, Textarea } from "../../components/ui/Input.jsx";
import Button from "../../components/ui/Button.jsx";

const MAX_FILES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export default function NewCheckPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);

  // Form inputs
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [upiId, setUpiId] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [handle, setHandle] = useState("");
  const [handlePlatform, setHandlePlatform] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [language, setLanguage] = useState("en");
  const [consent, setConsent] = useState(true);

  // Files
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  // More details accordion
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Submission state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function applySample(s) {
    setText(s.text || "");
    setUrl(s.url || "");
    setUpiId(s.upiId || "");
    setPhone(s.phone || "");
    setCompany(s.company || "");
    setHandle(s.handle || "");
    setHandlePlatform(s.handlePlatform || "");
    setUserNotes(s.userNotes || "");
    setConsent(true);
    if (s.url || s.upiId || s.phone || s.company || s.handle || s.userNotes) {
      setShowMoreDetails(true);
    }
  }

  function validateAndAddFiles(newFiles) {
    setError(null);
    const valid = [];
    for (const f of newFiles) {
      if (!f.type.startsWith("image/")) {
        setError(`"${f.name}" is not an image. Only PNG, JPEG, and WebP images are supported.`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        setError(`"${f.name}" exceeds the 5MB size limit.`);
        continue;
      }
      valid.push(f);
    }

    const combined = [...files, ...valid].slice(0, MAX_FILES);
    if (files.length + valid.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} screenshots allowed.`);
    }

    setFiles(combined);

    // Create preview URLs
    const newPreviews = combined.map((f) => ({
      name: f.name,
      size: `${(f.size / 1024).toFixed(0)} KB`,
      url: URL.createObjectURL(f),
    }));
    setPreviews(newPreviews);
  }

  function handleFileSelect(e) {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) {
      validateAndAddFiles(selected);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length > 0) {
      validateAndAddFiles(dropped);
    }
  }

  function removeFile(index) {
    const updatedFiles = files.filter((_, i) => i !== index);
    const updatedPreviews = previews.filter((_, i) => i !== index);
    setFiles(updatedFiles);
    setPreviews(updatedPreviews);
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();

    if (!text.trim() && files.length === 0) {
      setError("Please provide either message text or at least one screenshot to verify.");
      return;
    }

    if (!consent) {
      setError("Please check the consent acknowledgment to proceed.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      if (text.trim()) formData.append("text", text.trim());
      formData.append("language", language);
      formData.append("consent", consent ? "true" : "false");
      if (url.trim()) formData.append("url", url.trim());
      if (upiId.trim()) formData.append("upiId", upiId.trim());
      if (phone.trim()) formData.append("phone", phone.trim());
      if (company.trim()) formData.append("company", company.trim());
      if (handle.trim()) formData.append("handle", handle.trim());
      if (handlePlatform) formData.append("handlePlatform", handlePlatform);
      if (userNotes.trim()) formData.append("userNotes", userNotes.trim());

      files.forEach((file) => formData.append("images", file));

      const res = await fetch("/api/checks", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to submit verification check.");
      }

      const targetId = data.id || data.checkId;
      if (targetId) {
        // Record in client-side localStorage history
        try {
          const stored = JSON.parse(localStorage.getItem("ov_recent_checks") || "[]");
          const entry = {
            id: targetId,
            text: text.trim().slice(0, 120) || "Screenshot verification",
            riskLevel: "pending",
            createdAt: new Date().toISOString(),
          };
          const updated = [entry, ...stored.filter((s) => s.id !== targetId)].slice(0, 20);
          localStorage.setItem("ov_recent_checks", JSON.stringify(updated));
          localStorage.setItem("aegis_recent_checks", JSON.stringify(updated));
        } catch {
          // ignore localStorage
        }

        router.push(`/check/${targetId}`);
      } else {
        throw new Error("Missing check ID from server response.");
      }
    } catch (err) {
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8 sm:py-12">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0A0A0A] dark:text-white">
          Check an offer
        </h1>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
          Paste the message or upload screenshots. All uploads expire within 24 hours.
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
          <span>Example:</span>
          <button
            type="button"
            onClick={() =>
              applySample({
                text: "Congratulations! You have been shortlisted for a 3-month remote Software Developer Internship at TechCorp India. Monthly stipend is ₹35,000. To confirm your seat and receive the training toolkit, pay a refundable security deposit of ₹3,500 to our HR coordinator upi: hr-techcorp@oksbi. Official site: http://techcorp-internship-careers.xyz",
                upiId: "hr-techcorp@oksbi",
                url: "http://techcorp-internship-careers.xyz",
                company: "TechCorp India",
                userNotes: "Received via an unsolicited email from a free outlook address.",
              })
            }
            className="text-neutral-700 dark:text-neutral-300 underline underline-offset-2 hover:text-[#0A0A0A] dark:hover:text-white transition-colors"
          >
            Fake Internship (TechCorp)
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2.5">
          <svg className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="leading-snug">{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* Message Text Input */}
        <Textarea
          id="text-input"
          label="Message, email, or offer text"
          rows={5}
          placeholder="Paste WhatsApp message, email offer letter, Telegram text, or details of the scholarship/job opportunity..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={loading}
        />

        {/* Screenshot Upload Drop Zone */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            Screenshots (optional, up to 5)
          </label>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              isDragging
                ? "border-[#0A0A0A] dark:border-white bg-neutral-100 dark:bg-white/10"
                : "border-[#E5E7EB] dark:border-white/15 hover:border-neutral-400 dark:hover:border-white/30 bg-neutral-50/50 dark:bg-white/[0.02]"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              disabled={loading}
            />

            <div className="flex flex-col items-center gap-2">
              <span className="w-9 h-9 rounded-full bg-neutral-200/70 dark:bg-white/10 flex items-center justify-center text-neutral-600 dark:text-neutral-300">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </span>
              <div className="text-xs text-neutral-600 dark:text-neutral-400">
                <span className="font-semibold text-[#0A0A0A] dark:text-white">Click to upload</span> or drag and drop
              </div>
              <p className="text-[11px] text-neutral-500 font-mono">PNG, JPG or WebP up to 5MB each</p>
            </div>
          </div>

          {/* Previews */}
          {previews.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
              {previews.map((item, index) => (
                <div
                  key={index}
                  className="relative group border border-[#E5E7EB] dark:border-white/10 rounded-lg p-2 bg-white dark:bg-[#121215] flex items-center gap-2"
                >
                  <img
                    src={item.url}
                    alt={item.name}
                    className="w-10 h-10 object-cover rounded bg-neutral-100 dark:bg-white/5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate">{item.name}</p>
                    <p className="text-[10px] text-neutral-500 font-mono">{item.size}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="p-1 rounded text-neutral-400 hover:text-rose-600 transition-colors"
                    aria-label={`Remove ${item.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Collapsible More Details */}
        <div className="border border-[#E5E7EB] dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-[#121215]">
          <button
            type="button"
            onClick={() => setShowMoreDetails(!showMoreDetails)}
            className="w-full min-h-[44px] px-4 py-3 flex items-center justify-between text-xs font-semibold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors"
          >
            <span>More details (optional)</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform duration-150 ${showMoreDetails ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showMoreDetails && (
            <div className="p-4 pt-1 border-t border-[#E5E7EB] dark:border-white/10 flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Website / Link"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                />
                <Input
                  label="UPI ID"
                  placeholder="name@okaxis"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Contact Phone"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={loading}
                />
                <Input
                  label="Claimed Company / Org"
                  placeholder="Acme Technologies"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Social / Messaging Handle"
                  placeholder="@careers_support"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  disabled={loading}
                />
                <div className="flex flex-col gap-1.5 w-full">
                  <label htmlFor="handle-platform" className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                    Handle Platform
                  </label>
                  <select
                    id="handle-platform"
                    value={handlePlatform}
                    onChange={(e) => setHandlePlatform(e.target.value)}
                    disabled={loading}
                    className="w-full min-h-[44px] sm:min-h-[38px] px-3 text-sm rounded-md border border-[#E5E7EB] dark:border-white/10 bg-white dark:bg-[#121215] text-[#0A0A0A] dark:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] dark:focus:ring-white"
                  >
                    <option value="">Select platform...</option>
                    <option value="telegram">Telegram</option>
                    <option value="instagram">Instagram</option>
                    <option value="youtube">YouTube</option>
                    <option value="x">X / Twitter</option>
                    <option value="reddit">Reddit</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <Textarea
                label="Other information (user context)"
                rows={2}
                placeholder="Where did you find this? (e.g. unsolicited WhatsApp message, job board, campus poster)"
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                disabled={loading}
              />
            </div>
          )}
        </div>

        {/* Language & Consent */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
            <span>Report Language</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium border transition-colors ${
                  language === "en"
                    ? "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] border-transparent"
                    : "border-[#E5E7EB] dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5"
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLanguage("hi")}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium border transition-colors ${
                  language === "hi"
                    ? "bg-[#0A0A0A] dark:bg-white text-white dark:text-[#0A0A0A] border-transparent"
                    : "border-[#E5E7EB] dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5"
                }`}
              >
                हिंदी
              </button>
            </div>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed select-none">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 rounded border-[#E5E7EB] dark:border-white/20 text-[#0A0A0A] focus:ring-0 w-4 h-4"
            />
            <span>
              I confirm I am submitting this content for safety evaluation. I understand this is an automated educational risk assessment, not a legal verdict.
            </span>
          </label>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          disabled={loading}
          className="w-full mt-2"
        >
          <span>Verify this offer</span>
        </Button>
      </form>
    </div>
  );
}

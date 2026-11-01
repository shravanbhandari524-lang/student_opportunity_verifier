"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export const EXTRACTION_STRINGS = {
  en: {
    promptTitle: "Do you want to extract the content of this link?",
    promptNote:
      "We open the link from our server, read the pages, and delete the result after 24 hours. Nothing is saved to the scam graph.",
    yesBtn: "Yes, extract",
    noBtn: "No, skip",
    skippedText: "Link content extraction skipped for",
    extractAnyway: "Extract anyway",
    runningText: "Extracting content from",
    runningStatus: "Reading pages from server...",
    doneTitle: "Extracted Link Content",
    infoOnlyNote: "This is information only. It does not change the risk level.",
    limitedTo: "Results limited to",
    pages: "pages",
    pagesListHeading: "Pages Inspected",
    formsHeading: "Forms Detected",
    externalDomainsHeading: "External Domains Referenced",
    noForms: "No interactive HTML forms found.",
    noExternal: "No external third-party domains referenced.",
    viewExcerpt: "View text excerpt",
    hideExcerpt: "Hide text excerpt",
    status: "Status",
    linksFound: "Links found",
    retry: "Retry extraction",
    unavailable:
      "The crawler is not available right now. The rest of your report is not affected.",
    busy: "Another extraction is running, try again in a few seconds.",
    notAllowed: "This link can't be extracted.",
    expired: "Check not found or expired.",
    timeout:
      "Extraction is taking longer than expected. You can check back later.",
    genericError: "Extraction failed. Please try again.",
  },
  hi: {
    promptTitle: "क्या आप इस लिंक की सामग्री निकालना चाहते हैं?",
    promptNote:
      "हम इस लिंक को अपने सर्वर से खोलते हैं, पृष्ठों को पढ़ते हैं, और 24 घंटों के बाद परिणाम हटा देते हैं। स्कैम ग्राफ में कुछ भी सहेजा नहीं जाता है।",
    yesBtn: "हाँ, निकालें",
    noBtn: "नहीं, छोड़ें",
    skippedText: "के लिए लिंक सामग्री निकालना छोड़ दिया गया",
    extractAnyway: "फिर भी निकालें",
    runningText: "से सामग्री निकाली जा रही है",
    runningStatus: "सर्वर से पृष्ठ पढ़े जा रहे हैं...",
    doneTitle: "निकाली गई लिंक सामग्री",
    infoOnlyNote: "यह केवल सूचनात्मक है। यह जोखिम स्तर को नहीं बदलता है।",
    limitedTo: "परिणाम सीमित हैं",
    pages: "पृष्ठों तक",
    pagesListHeading: "जांचे गए पृष्ठ",
    formsHeading: "पाए गए फ़ॉर्म",
    externalDomainsHeading: "संदर्भित बाहरी डोमेन",
    noForms: "कोई इंटरैक्टिव HTML फ़ॉर्म नहीं मिला।",
    noExternal: "कोई बाहरी थर्ड-पार्टी डोमेन संदर्भित नहीं है।",
    viewExcerpt: "टेक्स्ट का अंश देखें",
    hideExcerpt: "टेक्स्ट का अंश छुपाएं",
    status: "स्थिति",
    linksFound: "मिले हुए लिंक",
    retry: "पुनः प्रयास करें",
    unavailable:
      "क्रॉलर अभी उपलब्ध नहीं है। आपकी बाकी रिपोर्ट प्रभावित नहीं होगी।",
    busy: "एक अन्य निष्कर्षण चल रहा है, कृपया कुछ सेकंड बाद पुनः प्रयास करें।",
    notAllowed: "इस लिंक की सामग्री नहीं निकाली जा सकती।",
    expired: "जाँच नहीं मिली या समाप्त हो गई।",
    timeout:
      "निष्कर्षण में अपेक्षा से अधिक समय लग रहा है। आप बाद में जाँच कर सकते हैं।",
    genericError: "निष्कर्षण विफल रहा। कृपया पुनः प्रयास करें।",
  },
};

/**
 * Extracts and sanitizes hostname from url or domain entity value.
 * Never returns query strings or protocol paths.
 *
 * @param {object} entity
 * @returns {string} Clean hostname
 */
export function getHostFromEntity(entity) {
  if (!entity || !entity.value) return "";
  const val = String(entity.value).trim();
  try {
    if (val.startsWith("http://") || val.startsWith("https://")) {
      const parsed = new URL(val);
      return parsed.hostname;
    }
    const clean = val.split("/")[0].split("?")[0].split("#")[0].trim();
    return clean;
  } catch {
    return val.split("/")[0];
  }
}

/**
 * LinkExtractionCard component
 * Renders an optional read-only crawl prompt and display for confirmed url/domain entities.
 */
export default function LinkExtractionCard({
  checkId,
  entity,
  lang = "en",
  initialState = null,
}) {
  const t = EXTRACTION_STRINGS[lang] || EXTRACTION_STRINGS.en;
  const host = getHostFromEntity(entity);

  // States: "prompt", "skipped", "running", "done", "failed"
  const [state, setState] = useState(initialState?.state || "prompt");
  const [result, setResult] = useState(initialState?.result || null);
  const [errorMessage, setErrorMessage] = useState(initialState?.errorMessage || "");
  const [expandedPages, setExpandedPages] = useState({});

  const pollTimerRef = useRef(null);
  const pollStartRef = useRef(0);
  const isFetchingRef = useRef(false);
  const isMountedRef = useRef(true);

  const clearTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const mapErrorCodeToMessage = useCallback(
    (code, statusHttp) => {
      if (code === "CRAWLER_UNAVAILABLE") return t.unavailable;
      if (code === "SERVICE_UNAVAILABLE" || statusHttp === 503) return t.busy;
      if (code === "CRAWL_NOT_ALLOWED" || statusHttp === 400) return t.notAllowed;
      if (code === "CHECK_EXPIRED" || statusHttp === 404 || statusHttp === 410) return t.expired;
      return t.genericError;
    },
    [t]
  );

  // Poll status endpoint
  const pollStatus = useCallback(async () => {
    if (!isMountedRef.current || isFetchingRef.current) return;

    // Check 3-minute timeout (180s)
    const elapsed = Date.now() - pollStartRef.current;
    if (elapsed > 180000) {
      clearTimer();
      setState("failed");
      setErrorMessage(t.timeout);
      return;
    }

    isFetchingRef.current = true;
    try {
      const res = await fetch(`/api/checks/${checkId}/crawl?entityId=${encodeURIComponent(entity.id)}`);
      if (!isMountedRef.current) return;

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        clearTimer();
        setState("failed");
        setErrorMessage(mapErrorCodeToMessage(body.code, res.status));
        return;
      }

      const data = await res.json();
      if (!isMountedRef.current) return;

      if (data.status === "done" && data.result) {
        clearTimer();
        setResult(data.result);
        setState("done");
      } else if (data.status === "failed") {
        clearTimer();
        setState("failed");
        setErrorMessage(mapErrorCodeToMessage(data.errorCode));
      } else if (data.status === "running") {
        pollTimerRef.current = setTimeout(pollStatus, 2000);
      }
    } catch {
      if (isMountedRef.current) {
        clearTimer();
        setState("failed");
        setErrorMessage(t.genericError);
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [checkId, entity.id, clearTimer, mapErrorCodeToMessage, t.timeout, t.genericError]);

  // Read-only initial status check on mount (does NOT trigger any crawl)
  useEffect(() => {
    isMountedRef.current = true;

    // Skip network call if initialState is provided (e.g. testing)
    if (initialState) return () => {};

    async function checkInitialStatus() {
      try {
        const res = await fetch(`/api/checks/${checkId}/crawl?entityId=${encodeURIComponent(entity.id)}`);
        if (!isMountedRef.current) return;
        if (res.ok) {
          const data = await res.json();
          if (data.status === "done" && data.result) {
            setResult(data.result);
            setState("done");
          } else if (data.status === "running") {
            setState("running");
            pollStartRef.current = Date.now();
            pollTimerRef.current = setTimeout(pollStatus, 2000);
          } else if (data.status === "failed") {
            setState("failed");
            setErrorMessage(mapErrorCodeToMessage(data.errorCode));
          }
        }
      } catch {
        // Read-only failure defaults to keeping prompt state
      }
    }

    checkInitialStatus();

    return () => {
      isMountedRef.current = false;
      clearTimer();
    };
  }, [checkId, entity.id, clearTimer, mapErrorCodeToMessage, pollStatus, initialState]);

  // Handler: "Yes, extract"
  async function handleStartCrawl() {
    clearTimer();
    setState("running");
    setErrorMessage("");
    pollStartRef.current = Date.now();

    try {
      const res = await fetch(`/api/checks/${checkId}/crawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: String(entity.id) }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState("failed");
        setErrorMessage(mapErrorCodeToMessage(body.code, res.status));
        return;
      }

      const data = await res.json();
      if (data.status === "done" && data.result) {
        setResult(data.result);
        setState("done");
        return;
      }

      // Schedule first poll
      pollTimerRef.current = setTimeout(pollStatus, 2000);
    } catch {
      setState("failed");
      setErrorMessage(t.genericError);
    }
  }

  // Handler: "No, skip"
  function handleSkip() {
    clearTimer();
    setState("skipped");
  }

  // Handler: "Extract anyway" (restores prompt)
  function handleExtractAnyway() {
    clearTimer();
    setState("prompt");
    setErrorMessage("");
  }

  function togglePageExcerpt(pageIndex) {
    setExpandedPages((prev) => ({
      ...prev,
      [pageIndex]: !prev[pageIndex],
    }));
  }

  // Minimum 44px touch target button style
  const btnStyle = {
    minHeight: "44px",
    minWidth: "44px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.5rem 1.25rem",
    fontSize: "14px",
    fontWeight: 600,
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "transform 100ms ease-out, background-color 150ms ease",
    outlineOffset: "2px",
  };

  // 1. SKIPPED STATE
  if (state === "skipped") {
    return (
      <div
        className="panel-subtle"
        style={{
          padding: "0.75rem 1rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          minHeight: "56px",
        }}
      >
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {lang === "hi"
            ? `${host} ${t.skippedText}.`
            : `${t.skippedText} ${host}.`}
        </span>
        <button
          type="button"
          onClick={handleExtractAnyway}
          className="btn btn-ghost btn-sm"
          style={{
            ...btnStyle,
            minHeight: "44px",
            fontSize: "13px",
            textDecoration: "underline",
          }}
          aria-label={`${t.extractAnyway} for ${host}`}
        >
          {t.extractAnyway}
        </button>
      </div>
    );
  }

  // 2. RUNNING STATE
  if (state === "running") {
    return (
      <div
        className="panel"
        role="status"
        aria-live="polite"
        style={{
          padding: "1.25rem",
          borderLeft: "4px solid var(--accent-primary)",
          minHeight: "96px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="status-dot amber" aria-hidden="true" />
          <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>
            {lang === "hi"
              ? `${host} ${t.runningText}...`
              : `${t.runningText} ${host}...`}
          </strong>
        </div>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)", paddingLeft: "1.5rem" }}>
          {t.runningStatus}
        </span>
      </div>
    );
  }

  // 3. FAILED STATE
  if (state === "failed") {
    return (
      <div
        className="panel"
        style={{
          padding: "1.25rem",
          borderLeft: "4px solid var(--status-crimson)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              color: "var(--status-crimson)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              display: "block",
              marginBottom: "2px",
            }}
          >
            {host}
          </span>
          <p style={{ fontSize: "14px", color: "var(--text-primary)", margin: 0 }}>
            {errorMessage || t.genericError}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
          <button
            type="button"
            onClick={handleStartCrawl}
            className="btn btn-primary"
            style={btnStyle}
            aria-label={`${t.retry} for ${host}`}
          >
            {t.retry}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            className="btn btn-secondary"
            style={btnStyle}
            aria-label={`${t.noBtn} for ${host}`}
          >
            {t.noBtn}
          </button>
        </div>
      </div>
    );
  }

  // 4. DONE / RESULT VIEW (STRICTLY PLAIN TEXT, NO DANGEROUSLY SET INNER HTML)
  if (state === "done" && result) {
    const pages = Array.isArray(result.pages) ? result.pages : [];
    const forms = Array.isArray(result.forms) ? result.forms : [];
    const externalDomains = Array.isArray(result.externalDomains) ? result.externalDomains : [];
    const truncated = Boolean(result.truncated);
    const maxPages = result.limitsUsed?.maxPages || pages.length;

    return (
      <div
        className="panel"
        style={{
          padding: "1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {/* Header & Mandatory PRD Disclaimer */}
        <div style={{ borderBottom: "1px solid var(--border-primary)", paddingBottom: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
              {t.doneTitle}: <span style={{ fontFamily: "var(--font-mono)" }}>{host}</span>
            </h3>
            {truncated && (
              <span
                style={{
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  padding: "2px 8px",
                  backgroundColor: "var(--bg-muted)",
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-muted)",
                }}
              >
                {t.limitedTo} {maxPages} {t.pages}
              </span>
            )}
          </div>
          <p
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              marginTop: "4px",
              marginBottom: 0,
              fontStyle: "italic",
            }}
          >
            {t.infoOnlyNote}
          </p>
        </div>

        {/* Section 1: Pages Inspected */}
        <section aria-label={t.pagesListHeading}>
          <h4
            style={{
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--text-secondary)",
              marginBottom: "8px",
            }}
          >
            {t.pagesListHeading} ({pages.length})
          </h4>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {pages.map((p, idx) => (
              <div
                key={idx}
                style={{
                  border: "1px solid var(--border-primary)",
                  borderRadius: "var(--radius-sm)",
                  padding: "10px 12px",
                  backgroundColor: "var(--bg-primary)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "6px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                    {p.title || `Page ${idx + 1}`}
                  </span>
                  <div style={{ display: "flex", gap: "8px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    <span>{t.status}: {p.status ?? "--"}</span>
                    <span>·</span>
                    <span>{t.linksFound}: {p.linkCount ?? 0}</span>
                  </div>
                </div>

                {p.textExcerpt && (
                  <div style={{ marginTop: "6px" }}>
                    <button
                      type="button"
                      onClick={() => togglePageExcerpt(idx)}
                      className="btn btn-ghost btn-sm"
                      style={{
                        padding: "2px 0",
                        fontSize: "12px",
                        color: "var(--accent-primary)",
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                      aria-expanded={Boolean(expandedPages[idx])}
                    >
                      {expandedPages[idx] ? t.hideExcerpt : t.viewExcerpt}
                    </button>

                    {expandedPages[idx] && (
                      <pre
                        style={{
                          marginTop: "6px",
                          padding: "8px 10px",
                          backgroundColor: "var(--bg-muted)",
                          border: "1px solid var(--border-primary)",
                          borderRadius: "var(--radius-sm)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "12px",
                          color: "var(--text-secondary)",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          maxHeight: "160px",
                          overflowY: "auto",
                        }}
                      >
                        {p.textExcerpt}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Section 2: Forms Detected */}
        <section aria-label={t.formsHeading}>
          <h4
            style={{
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--text-secondary)",
              marginBottom: "8px",
            }}
          >
            {t.formsHeading} ({forms.length})
          </h4>

          {forms.length === 0 ? (
            <span style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>
              {t.noForms}
            </span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {forms.map((f, idx) => (
                <div
                  key={idx}
                  style={{
                    border: "1px solid var(--border-primary)",
                    borderRadius: "var(--radius-sm)",
                    padding: "10px 12px",
                    backgroundColor: "var(--bg-primary)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                    <div style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                      <strong style={{ fontFamily: "var(--font-mono)", marginRight: "6px" }}>
                        {f.method || "GET"}
                      </strong>
                      <span>→</span>
                      <span style={{ fontFamily: "var(--font-mono)", marginLeft: "6px" }}>
                        {f.actionHost || host}
                      </span>
                    </div>

                    {/* Sensitive Form Badges with explicit Text Labels and Color */}
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {f.hasPassword && (
                        <span
                          className="badge"
                          style={{
                            backgroundColor: "var(--status-crimson-bg, rgba(220, 38, 38, 0.1))",
                            color: "var(--status-crimson)",
                            border: "1px solid var(--status-crimson)",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          [Password Required]
                        </span>
                      )}
                      {f.hasOtp && (
                        <span
                          className="badge"
                          style={{
                            backgroundColor: "var(--status-amber-bg, rgba(217, 119, 6, 0.1))",
                            color: "var(--status-amber)",
                            border: "1px solid var(--status-amber)",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          [OTP Field]
                        </span>
                      )}
                      {f.hasUpi && (
                        <span
                          className="badge"
                          style={{
                            backgroundColor: "var(--status-crimson-bg, rgba(220, 38, 38, 0.1))",
                            color: "var(--status-crimson)",
                            border: "1px solid var(--status-crimson)",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          [UPI Payment ID]
                        </span>
                      )}
                      {f.hasPayment && (
                        <span
                          className="badge"
                          style={{
                            backgroundColor: "var(--status-amber-bg, rgba(217, 119, 6, 0.1))",
                            color: "var(--status-amber)",
                            border: "1px solid var(--status-amber)",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          [Payment Method]
                        </span>
                      )}
                    </div>
                  </div>

                  {Array.isArray(f.fieldTypes) && f.fieldTypes.length > 0 && (
                    <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                      Fields: {f.fieldTypes.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 3: External Domains Referenced */}
        <section aria-label={t.externalDomainsHeading}>
          <h4
            style={{
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--text-secondary)",
              marginBottom: "8px",
            }}
          >
            {t.externalDomainsHeading} ({externalDomains.length})
          </h4>

          {externalDomains.length === 0 ? (
            <span style={{ fontSize: "13px", color: "var(--text-muted)", fontStyle: "italic" }}>
              {t.noExternal}
            </span>
          ) : (
            <ul style={{ paddingLeft: "1.25rem", margin: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
              {externalDomains.map((dom, idx) => (
                <li key={idx} style={{ fontSize: "13px", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                  {dom}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // 5. PROMPT STATE (DEFAULT)
  return (
    <div
      className="panel"
      style={{
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div>
        <span
          style={{
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            color: "var(--accent-primary)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            display: "block",
            marginBottom: "2px",
          }}
        >
          {host}
        </span>
        <h3
          style={{
            fontSize: "15px",
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: "0 0 4px 0",
          }}
        >
          {t.promptTitle}
        </h3>
        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          {t.promptNote}
        </p>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "4px" }}>
        <button
          type="button"
          onClick={handleStartCrawl}
          className="btn btn-primary"
          style={btnStyle}
          aria-label={`${t.yesBtn} for ${host}`}
        >
          {t.yesBtn}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          className="btn btn-secondary"
          style={btnStyle}
          aria-label={`${t.noBtn} for ${host}`}
        >
          {t.noBtn}
        </button>
      </div>
    </div>
  );
}

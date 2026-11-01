/**
 * services/crawler/src/adapter.js
 *
 * Adapts internal deepcrawl execution result to the standardized CrawlResult shape.
 * Invariant: Self-contained within services/crawler; must NEVER import from root lib/.
 */

/**
 * Maps internal crawler stopReason or job errors to standard error code enum.
 *
 * @param {string} [stopReason]
 * @param {string[]} [errors=[]]
 * @returns {string|undefined}
 */
export function mapErrorCode(stopReason, errors = []) {
  if (stopReason === 'byteLimit') return 'BYTE_LIMIT';
  if (stopReason === 'timeLimit') return 'TIMEOUT';
  if (stopReason === 'maxPages') return 'TOO_MANY_PAGES';

  const errText = errors.join(' ').toLowerCase();
  if (errText.includes('disallowed by robots.txt') || errText.includes('robots_denied')) {
    return 'ROBOTS_DENIED';
  }
  if (errText.includes('dns lookup') || errText.includes('enotfound') || errText.includes('dns_failed')) {
    return 'DNS_FAILED';
  }
  if (errText.includes('blocked request') || errText.includes('blocked host') || errText.includes('blocked_host')) {
    return 'BLOCKED_HOST';
  }
  if (errText.includes('upstream') || errText.includes('502 bad gateway')) {
    return 'UPSTREAM_ERROR';
  }

  return undefined;
}

/**
 * Transforms internal crawler job output to public CrawlResult contract shape.
 *
 * @param {object} internalResult
 * @returns {object} Standardized CrawlResult object
 */
export function adaptCrawlResult(internalResult = {}) {
  const rawPages = Array.isArray(internalResult.pages) ? internalResult.pages : [];
  const rawForms = Array.isArray(internalResult.forms) ? internalResult.forms : [];
  const rawExternal = Array.isArray(internalResult.externalDomains) ? internalResult.externalDomains : [];
  const rawLimits = internalResult.limitsUsed || {};
  const rawSummary = internalResult.summary || {};
  const rawErrors = Array.isArray(internalResult.errors) ? internalResult.errors : [];

  // Adapt pages
  const pages = rawPages.map((p) => {
    const rawText = typeof p.text === 'string' ? p.text : '';
    const textExcerpt = rawText.slice(0, 2000).trim();
    const linkCount =
      (p.links?.internal ? p.links.internal.length : 0) +
      (p.links?.external ? p.links.external.length : 0);

    return {
      url: p.url,
      finalUrl: p.finalUrl || p.url,
      status: typeof p.statusCode === 'number' ? p.statusCode : null,
      title: (p.title || '').trim(),
      textExcerpt,
      linkCount
    };
  });

  // Adapt forms
  const forms = rawForms.map((f) => {
    const fieldTypes = Array.isArray(f.fields)
      ? f.fields.map((field) => (field.type || 'text').toLowerCase())
      : [];

    return {
      actionHost: f.actionHost || '',
      method: (f.method || 'GET').toUpperCase(),
      fieldTypes,
      hasPassword: Boolean(f.hasPassword),
      hasOtp: Boolean(f.hasOtp),
      hasUpi: Boolean(f.hasUpi),
      hasPayment: Boolean(f.hasPayment)
    };
  });

  // Deduplicate and sanitize external domains
  const externalDomains = Array.from(
    new Set(
      rawExternal
        .map((d) => (typeof d === 'string' ? d.trim().toLowerCase() : ''))
        .filter(Boolean)
    )
  );

  const limitsUsed = {
    maxPages: Number(rawLimits.maxPages || 10),
    maxDepth: Number(rawLimits.maxDepth ?? 2),
    totalTimeSec: Number(rawLimits.totalTimeSec ?? Math.round((rawSummary.durationMs || 0) / 1000)),
    totalBytesReceived: Number(rawLimits.totalBytesReceived || 0),
    sameHostOnly: Boolean(rawLimits.sameHostOnly ?? true)
  };

  const errorCode = mapErrorCode(rawSummary.stopReason, rawErrors);

  const result = {
    pages,
    forms,
    externalDomains,
    truncated: Boolean(internalResult.truncated),
    limitsUsed
  };

  if (errorCode) {
    result.errorCode = errorCode;
  }

  return result;
}

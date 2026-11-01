/**
 * Returns the standard security headers for all API responses.
 *
 * @returns {Record<string, string>}
 */
export function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  };
}

/**
 * Returns cache-control headers preventing any caching or storing of responses.
 *
 * @returns {Record<string, string>}
 */
export function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

/**
 * Applies security headers and optional extra headers to an existing Response object.
 *
 * @param {Response} response
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Response}
 */
export function applySecurityHeaders(response, extraHeaders = {}) {
  const headers = new Headers(response.headers);

  // Apply default security headers
  const sec = securityHeaders();
  for (const [key, value] of Object.entries(sec)) {
    headers.set(key, value);
  }

  // Apply additional headers
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

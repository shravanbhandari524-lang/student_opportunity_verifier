import { getRuntime } from "../../../lib/api/runtime.js";
import { getClientKey } from "../../../lib/api/rate-limit.js";
import { noStoreHeaders } from "../../../lib/api/headers.js";
import { createRequestLogger } from "../../../lib/api/log.js";
import { env } from "../../../lib/env.js";
import {
  isGoogleAuthConfigured,
  getGoogleClient,
  sanitizeReturnTo,
  generateState,
  generateCodeVerifier,
  createOAuthStateToken,
  getOAuthCookieOptions,
  serializeCookie,
  OAUTH_COOKIE_NAME,
} from "../../../lib/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /auth/google
 *
 * Initiates Google OAuth 2.0 PKCE flow.
 * Creates state & code verifier, signs them into ov_oauth_state cookie,
 * and redirects to Google account selection.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/auth/google");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters } = runtimeDeps;

  try {
    const url = new URL(request.url);
    const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));

    // Check if OAuth is configured
    if (!isGoogleAuthConfigured(env)) {
      const fallbackUrl = new URL("/", url.origin);
      fallbackUrl.searchParams.set("auth_error", "auth_not_configured");
      return Response.redirect(fallbackUrl.toString(), 302);
    }

    // Rate limiting per IP
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    if (rateLimiters?.auth) {
      rateLimiters.auth.assertAllowed(clientKey);
    }

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const google = getGoogleClient(env);
    const authorizationUrl = google.createAuthorizationURL(state, codeVerifier, [
      "openid",
      "profile",
      "email",
    ]);

    const stateToken = await createOAuthStateToken(
      { state, codeVerifier, returnTo },
      env.JWT_SECRET
    );

    const headers = new Headers(noStoreHeaders());
    const cookieHeader = serializeCookie(
      OAUTH_COOKIE_NAME,
      stateToken,
      getOAuthCookieOptions()
    );
    headers.set("Set-Cookie", cookieHeader);
    headers.set("Location", authorizationUrl.toString());

    reqLogger.logResponse(302);
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (err) {
    reqLogger.logError(err);
    if (err?.code === "RATE_LIMITED" || err?.status === 429) {
      const origin = new URL(request.url).origin;
      return Response.redirect(`${origin}/?auth_error=rate_limited`, 302);
    }
    const origin = new URL(request.url).origin;
    return Response.redirect(`${origin}/?auth_error=oauth_init_failed`, 302);
  }
}

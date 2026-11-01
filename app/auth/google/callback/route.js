import crypto from "node:crypto";
import { getRuntime } from "../../../../lib/api/runtime.js";
import { getClientKey } from "../../../../lib/api/rate-limit.js";
import { noStoreHeaders } from "../../../../lib/api/headers.js";
import { createRequestLogger } from "../../../../lib/api/log.js";
import { env } from "../../../../lib/env.js";
import {
  isGoogleAuthConfigured,
  getGoogleClient,
  verifyOAuthStateToken,
  createSessionJwt,
  parseCookies,
  getSessionCookieOptions,
  getOAuthCookieOptions,
  serializeCookie,
  serializeClearCookie,
  OAUTH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  decodeIdToken,
} from "../../../../lib/auth.js";
import { upsertUser, createSession } from "../../../../lib/db/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /auth/google/callback
 *
 * Handles Google OAuth 2.0 PKCE redirect callback.
 * Validates state token, exchanges code for user profile, upserts user,
 * establishes a 7-day session, and redirects to returnTo.
 */
export async function GET(request, context = {}) {
  const reqLogger = createRequestLogger(request, "/auth/google/callback");
  const runtimeDeps = context.runtime || getRuntime();
  const { rateLimiters, db } = runtimeDeps;
  const url = new URL(request.url);
  const origin = url.origin;

  const errorRedirect = (errorKey, clearOAuth = true) => {
    const target = new URL("/", origin);
    target.searchParams.set("auth_error", errorKey);
    const headers = new Headers(noStoreHeaders());
    if (clearOAuth) {
      headers.append(
        "Set-Cookie",
        serializeClearCookie(OAUTH_COOKIE_NAME, getOAuthCookieOptions())
      );
    }
    headers.set("Location", target.toString());
    reqLogger.logResponse(302);
    return new Response(null, { status: 302, headers });
  };

  try {
    if (!isGoogleAuthConfigured(env)) {
      return errorRedirect("auth_not_configured");
    }

    // Rate limiting
    const clientKey = getClientKey(request, {
      trustProxy: Boolean(env.TRUST_PROXY),
      trustedHops: Number(env.TRUSTED_PROXY_HOPS) || 1,
    });
    if (rateLimiters?.auth) {
      rateLimiters.auth.assertAllowed(clientKey);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      return errorRedirect("oauth_access_denied");
    }

    if (!code || !state) {
      return errorRedirect("missing_code");
    }

    // Extract ov_oauth_state cookie
    const cookies = parseCookies(request);
    const stateCookieToken = cookies[OAUTH_COOKIE_NAME];
    if (!stateCookieToken) {
      return errorRedirect("missing_state_cookie");
    }

    // Verify state token
    const stored = await verifyOAuthStateToken(stateCookieToken, env.JWT_SECRET);
    if (!stored || stored.state !== state) {
      return errorRedirect("state_mismatch");
    }

    // Exchange code for tokens
    const google = getGoogleClient(env);
    let tokens;
    try {
      tokens = await google.validateAuthorizationCode(code, stored.codeVerifier);
    } catch (err) {
      reqLogger.logError(err);
      return errorRedirect("oauth_token_exchange_failed");
    }

    const idToken = tokens.idToken();
    if (!idToken) {
      return errorRedirect("missing_id_token");
    }

    const claims = decodeIdToken(idToken);
    if (!claims?.sub || !claims?.email) {
      return errorRedirect("invalid_id_token");
    }

    if (!claims.email_verified) {
      return errorRedirect("unverified_email");
    }

    // Upsert user
    const user = upsertUser(
      {
        googleSub: claims.sub,
        email: claims.email,
        name: claims.name || claims.email.split("@")[0],
        avatarUrl: claims.picture || null,
      },
      db
    );

    // Create session (7 days)
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    createSession(
      {
        id: sessionId,
        userId: user.id,
        expiresAt,
      },
      db
    );

    // Sign session JWT
    const sessionToken = await createSessionJwt(
      {
        sessionId,
        userId: user.id,
      },
      env.JWT_SECRET
    );

    // Destination
    const returnTarget = new URL(stored.returnTo || "/", origin);

    const headers = new Headers(noStoreHeaders());
    // Clear oauth state cookie
    headers.append(
      "Set-Cookie",
      serializeClearCookie(OAUTH_COOKIE_NAME, getOAuthCookieOptions())
    );
    // Set 7-day session cookie
    headers.append(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions())
    );
    headers.set("Location", returnTarget.toString());

    reqLogger.logResponse(302);
    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (err) {
    reqLogger.logError(err);
    if (err?.code === "RATE_LIMITED" || err?.status === 429) {
      return errorRedirect("rate_limited");
    }
    return errorRedirect("oauth_failed");
  }
}

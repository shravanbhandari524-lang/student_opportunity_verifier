import { Google, generateState, generateCodeVerifier, decodeIdToken } from "arctic";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env.js";
import {
  getUserById,
  upsertUser,
  createSession,
  getSession,
  deleteSession,
} from "./db/index.js";

export const OAUTH_COOKIE_NAME = "ov_oauth_state";
export const SESSION_COOKIE_NAME = "session";

/**
 * Checks whether Google OAuth is fully configured in the environment.
 *
 * @param {object} [envObj=env]
 * @returns {boolean}
 */
export function isGoogleAuthConfigured(envObj = env) {
  return Boolean(
    envObj.GOOGLE_CLIENT_ID &&
    envObj.GOOGLE_CLIENT_SECRET &&
    envObj.JWT_SECRET &&
    envObj.GOOGLE_CLIENT_ID.trim().length > 0 &&
    envObj.GOOGLE_CLIENT_SECRET.trim().length > 0 &&
    envObj.JWT_SECRET.trim().length >= 32
  );
}

/**
 * Returns a configured Arctic Google OAuth2 client.
 *
 * @param {object} [envObj=env]
 * @returns {Google}
 */
export function getGoogleClient(envObj = env) {
  if (!isGoogleAuthConfigured(envObj)) {
    throw new Error("Google OAuth is not configured");
  }
  const callbackUrl =
    envObj.GOOGLE_CALLBACK_URL ||
    `${envObj.CLIENT_URL || "http://localhost:3000"}/auth/google/callback`;
  return new Google(
    envObj.GOOGLE_CLIENT_ID,
    envObj.GOOGLE_CLIENT_SECRET,
    callbackUrl
  );
}

/**
 * Sanitizes returnTo to prevent open redirects.
 * Must be a relative path on localhost (e.g., /check/123 or /history).
 * Disallows protocol relative URLs (//evil.com), backslashes, and schemes.
 *
 * @param {string | null | undefined} rawReturnTo
 * @returns {string}
 */
export function sanitizeReturnTo(rawReturnTo) {
  if (!rawReturnTo || typeof rawReturnTo !== "string") {
    return "/";
  }

  const trimmed = rawReturnTo.trim();

  // Must begin with a single '/' and not with '//' or '/\'
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return "/";
  }

  // Reject any backslashes
  if (trimmed.includes("\\")) {
    return "/";
  }

  try {
    const base = "http://localhost:3000";
    const parsed = new URL(trimmed, base);

    // Origin must be strictly base origin
    if (parsed.origin !== base) {
      return "/";
    }

    // Pathname must start with '/' and not start with '//'
    if (!parsed.pathname.startsWith("/") || parsed.pathname.startsWith("//")) {
      return "/";
    }

    // Disallow dangerous schemes or embedded colons before query string
    const pathPart = trimmed.split("?")[0].split("#")[0];
    if (pathPart.includes(":")) {
      return "/";
    }

    return parsed.pathname + parsed.search;
  } catch {
    return "/";
  }
}

/**
 * Cookie option generator for the short-lived OAuth state cookie (10m).
 *
 * @returns {object}
 */
export function getOAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60, // 10 minutes in seconds
  };
}

/**
 * Cookie option generator for the persistent session cookie (7d).
 *
 * @returns {object}
 */
export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  };
}

/**
 * Serializes a cookie header string.
 *
 * @param {string} name
 * @param {string} value
 * @param {object} [options]
 * @returns {string}
 */
export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  const sameSite = options.sameSite ? options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1).toLowerCase() : "Lax";
  parts.push(`SameSite=${sameSite}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Serializes a Set-Cookie string to clear/delete a cookie.
 *
 * @param {string} name
 * @param {object} [options]
 * @returns {string}
 */
export function serializeClearCookie(name, options = {}) {
  return serializeCookie(name, "", {
    ...options,
    maxAge: 0,
    expires: new Date(0),
  });
}

/**
 * Encodes secret key for Jose.
 *
 * @param {string} secret
 * @returns {Uint8Array}
 */
function getSecretKey(secret) {
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Signs an OAuth state token containing state, codeVerifier, and returnTo.
 *
 * @param {{ state: string, codeVerifier: string, returnTo: string }} payload
 * @param {string} [secret=env.JWT_SECRET]
 * @returns {Promise<string>}
 */
export async function createOAuthStateToken(payload, secret = env.JWT_SECRET) {
  const secretKey = getSecretKey(secret);
  return new SignJWT({
    state: payload.state,
    codeVerifier: payload.codeVerifier,
    returnTo: sanitizeReturnTo(payload.returnTo),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secretKey);
}

/**
 * Verifies an OAuth state token.
 *
 * @param {string} token
 * @param {string} [secret=env.JWT_SECRET]
 * @returns {Promise<{ state: string, codeVerifier: string, returnTo: string } | null>}
 */
export async function verifyOAuthStateToken(token, secret = env.JWT_SECRET) {
  if (!token) return null;
  try {
    const secretKey = getSecretKey(secret);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    return {
      state: String(payload.state || ""),
      codeVerifier: String(payload.codeVerifier || ""),
      returnTo: sanitizeReturnTo(payload.returnTo),
    };
  } catch {
    return null;
  }
}

/**
 * Signs a session JWT for a user.
 *
 * @param {{ sessionId: string, userId: string }} payload
 * @param {string} [secret=env.JWT_SECRET]
 * @returns {Promise<string>}
 */
export async function createSessionJwt(payload, secret = env.JWT_SECRET) {
  const secretKey = getSecretKey(secret);
  return new SignJWT({
    sessionId: payload.sessionId,
    userId: payload.userId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey);
}

/**
 * Verifies a session JWT.
 *
 * @param {string} token
 * @param {string} [secret=env.JWT_SECRET]
 * @returns {Promise<{ sessionId: string, userId: string } | null>}
 */
export async function verifySessionJwt(token, secret = env.JWT_SECRET) {
  if (!token) return null;
  try {
    const secretKey = getSecretKey(secret);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    if (!payload.sessionId || !payload.userId) {
      return null;
    }
    return {
      sessionId: String(payload.sessionId),
      userId: String(payload.userId),
    };
  } catch {
    return null;
  }
}

/**
 * Parses cookies from a Request or Headers object.
 *
 * @param {Request | Headers | string | null | undefined} requestOrHeader
 * @returns {Record<string, string>}
 */
export function parseCookies(requestOrHeader) {
  let cookieHeader = "";
  if (!requestOrHeader) return {};

  if (typeof requestOrHeader === "string") {
    cookieHeader = requestOrHeader;
  } else if (typeof requestOrHeader.headers?.get === "function") {
    cookieHeader = requestOrHeader.headers.get("cookie") || "";
  } else if (typeof requestOrHeader.get === "function") {
    cookieHeader = requestOrHeader.get("cookie") || "";
  } else if (requestOrHeader.cookies && typeof requestOrHeader.cookies.get === "function") {
    // Next.js Request with cookies.get()
    const all = {};
    if (typeof requestOrHeader.cookies.getAll === "function") {
      for (const c of requestOrHeader.cookies.getAll()) {
        all[c.name] = c.value;
      }
      return all;
    }
  }

  const result = {};
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...valParts] = part.trim().split("=");
    if (rawKey) {
      result[rawKey] = decodeURIComponent(valParts.join("="));
    }
  }
  return result;
}

/**
 * Resolves the authenticated session and user from a request.
 *
 * @param {Request | { headers: Headers, cookies?: any }} request
 * @param {import("better-sqlite3").Database} dbInstance
 * @param {object} [envObj=env]
 * @returns {Promise<{ user: import("./contracts/auth.js").User, session: import("./contracts/auth.js").Session } | null>}
 */
export async function getAuthSession(request, dbInstance, envObj = env) {
  if (!isGoogleAuthConfigured(envObj)) {
    return null;
  }

  let sessionToken = null;
  if (request?.cookies && typeof request.cookies.get === "function") {
    const cookie = request.cookies.get(SESSION_COOKIE_NAME);
    sessionToken = typeof cookie === "object" ? cookie.value : cookie;
  }

  if (!sessionToken) {
    const cookies = parseCookies(request);
    sessionToken = cookies[SESSION_COOKIE_NAME];
  }

  if (!sessionToken) {
    return null;
  }

  const verified = await verifySessionJwt(sessionToken, envObj.JWT_SECRET);
  if (!verified) {
    return null;
  }

  const sessionData = getSession(verified.sessionId, dbInstance);
  if (!sessionData || !sessionData.user) {
    return null;
  }

  return { user: sessionData.user, session: sessionData.session };
}

/**
 * Validates same-origin on state-changing requests to prevent CSRF.
 *
 * @param {Request} request
 * @param {string} [clientUrl=env.CLIENT_URL]
 * @returns {boolean}
 */
export function validateSameOrigin(request, clientUrl = env.CLIENT_URL || "http://localhost:3000") {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  let expectedOrigin;
  try {
    expectedOrigin = new URL(clientUrl).origin;
  } catch {
    expectedOrigin = "http://localhost:3000";
  }

  if (origin) {
    if (origin === expectedOrigin) return true;
    if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true;
    return false;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if (refUrl.origin === expectedOrigin) return true;
      if (host && (refUrl.origin === `http://${host}` || refUrl.origin === `https://${host}`)) return true;
    } catch {
      return false;
    }
  }

  // If both origin and referer are missing in a browser mutation, reject
  return false;
}

export { generateState, generateCodeVerifier, decodeIdToken };

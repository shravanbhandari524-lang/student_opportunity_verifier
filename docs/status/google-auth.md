# Optional Google OAuth Sign-In Delivery Status

## Summary
Added optional Google OAuth 2.0 PKCE authentication for localhost:3000. Anonymous checking remains 100% operational as before. Signed-in users receive cross-device check history, header profile controls, and account deletion.

## Schema & Database Migration (014)
- `users`: `id` (UUID PK), `google_sub` (UNIQUE), `email`, `name`, `avatar_url`, `created_at`, `last_login_at`.
- `sessions`: `id` (PK), `user_id` (FK CASCADE), `expires_at`, `created_at` (7-day TTL).
- `checks`: Added `user_id` (FK `users(id)` ON DELETE SET NULL). Associated on check creation when signed in.

## Routes & Endpoints
- `GET /auth/google`: Initiates PKCE S256 OAuth flow, signs 10m `ov_oauth_state` cookie, redirects to Google.
- `GET /auth/google/callback`: Verifies state, exchanges code for verified profile, upserts user, issues 7d session cookie.
- `POST /auth/logout`: Validates same-origin CSRF, deletes session from DB, clears session cookie.
- `GET /api/auth/me`: Returns `{ user: { id, name, email, avatarUrl } }` or `{ user: null }` (graceful 200).
- `GET /api/me/checks`: Returns active non-expired checks for authenticated user (401 if unauthenticated).
- `DELETE /api/me`: Validates same-origin CSRF, deletes user, cascades sessions, sets `checks.user_id = NULL`.

## Security & Privacy Measures
- **State & PKCE**: `arctic` `Google` client with PKCE code verifier and HS256 state token in HttpOnly SameSite=Lax cookie.
- **Open Redirect Guard**: `sanitizeReturnTo` strictly validates relative paths, rejecting protocol-relative URLs (`//`), backslashes, and schemes.
- **CSRF Protection**: `validateSameOrigin` enforces matching `Origin`/`Referer` on `POST /auth/logout` and `DELETE /api/me`.
- **Graceful Unconfigured Mode**: If Google credentials are missing, app runs without crashing; button displays unconfigured badge.
- **Data Deletion & Expiry**: User checks expire naturally after 24 hours. Account deletion cascades sessions immediately.

## Frontend Integration
- `app/layout.js`: Resolves session server-side to prevent client layout shift or authentication flash.
- `components/Header.js`: Displays "Sign in with Google" G button or user avatar dropdown with checks link and sign out.
- `components/AuthErrorToast.js`: Surface human-readable error messages for `?auth_error=` and cleans URL query string.
- `components/AccountDeletionModal.js`: Accessible modal with explicit confirmation for deleting account and personal data.
- `app/history/page.jsx`: Merges `/api/me/checks` with localStorage checks, deduplicated by check ID.

## Verification & Test Results
- Unit Tests: `tests/auth-unit.test.js` (5/5 passed).
- Route Tests: `tests/auth-routes.test.js` (7/7 passed).
- Migrations: `tests/migrations.test.js` (7/7 passed).
- UI Components: `tests/ui-components.test.js` (16/16 passed).
- Full Test Suite: `npm test` passed 1076/1076 tests across 72 suites (0 failures).
- Linter & Build: `npm run lint` (0 errors), `npm run build` (compiled clean, all routes static/dynamic generated).

## Manual Verification Steps (localhost:3000)
1. Add Google OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`) to `.env.local`.
2. Run `npm run dev` and navigate to `http://localhost:3000`.
3. Verify header displays "Sign in with Google" button with G logo.
4. Click button to complete Google sign-in; verify redirection back to initial page and avatar display.
5. Submit a check; verify `/history` lists the check with the "Account" badge.
6. Open profile dropdown -> "Sign out", then test anonymous check submission.

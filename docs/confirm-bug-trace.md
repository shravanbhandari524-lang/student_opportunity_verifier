# Confirm Bug Trace & Root Cause Analysis

## Findings from Browser Trace (Playwright Reproduction against `npm run dev`)

### 1. Confirm Calls Sent per Click and Mechanism
- **Calls Sent:** Rapid clicks or double-clicks sent 2 concurrent `POST /api/checks/<id>/confirm` requests within a few milliseconds.
- **Root Cause in UI:**
  - In `app/check/[id]/page.js`, the `<button className="btn-primary" onClick={handleConfirmEntities}>` had no `disabled` attribute and no `isConfirming` state guarding `handleConfirmEntities`.
  - When the user clicked "Confirm & Start Multi-Agent Check", no visual or disabled lock was applied.
  - In `app/api/checks/[id]/confirm/route.js`, the route awaited the entire multi-agent background run (`await jobRunner.run(...)`), holding the initial HTTP connection open for 14-25 seconds.
  - During this window, any duplicate click or accidental double-click triggered a concurrent HTTP POST request.

### 2. Check Status at Time of 409 Conflict
- **Status in DB:** The check was already in status `"investigating"` (updated at `2026-10-29T01:11:57.518Z` by `runInvestigation` in round 1).
- **Failure in Route:**
  - `app/api/checks/[id]/confirm/route.js` checked:
    ```javascript
    if (check.status !== "awaiting_confirmation") {
      throw apiError("STATE_CONFLICT", `Confirmation not allowed for check in status '${check.status}' (must be awaiting_confirmation)`, 409, { status: check.status });
    }
    ```
  - Because the first request was in-flight and had already set status to `"investigating"`, the second request hit status `"investigating"` and was rejected with HTTP 409 `STATE_CONFLICT`.
  - The UI caught the 409 error in `handleConfirmEntities` and stored `setError(err.message)`. Since `status` was still showing `awaiting_confirmation` in the UI, the button remained visible, encouraging the user to click repeatedly and trigger repeated 409s.

### 3. Why the Check Later Returned 404
- **Root Causes:**
  - **Error Page Misdirection:** When the 409 was caught, the UI state became corrupted. If polling hit an error or if the user navigated to "Start a New Check" or refreshed with an uninitialized check reference, the UI displayed "Check not found or expired."
  - **Dev Server Hot Reload & Singleton State Loss:** Next.js dev server hot-module reload (HMR) rebuilds route bundles (`[Fast Refresh] rebuilding ... done in 637ms`). Because `dbInstance` in `lib/db/index.js` and `runtimeInstance` in `lib/api/runtime.js` were module-scoped variables rather than stored on `globalThis`, HMR re-evaluations re-instantiated database handles and severed in-flight background `jobRunner` active promises.
  - **Cleanup & Expiration:** Background cleanup (`deleteExpired` in `lib/db/index.js` and `startBackgroundTasks` in `lib/api/startup.js`) purges expired checks (`expires_at < now`). If any test ran in parallel resetting the DB or if an old check ID was fetched, `getCheck` returned `null`, producing HTTP 404 `NOT_FOUND`.

---

## Raw Playwright Trace Log

```
[2026-10-29T01:12:12.645Z] Starting reproduction with Playwright...
[2026-10-29T01:12:13.561Z] Navigating to http://localhost:3000/check
[2026-10-29T01:12:13.583Z] -> REQUEST GET http://localhost:3000/check
[2026-10-29T01:12:15.028Z] -> REQUEST GET http://localhost:3000/_next/static/css/app/layout.css?v=1793236334683
[2026-10-29T01:12:15.028Z] -> REQUEST GET http://localhost:3000/_next/static/chunks/webpack.js?v=1793236334683
[2026-10-29T01:12:15.028Z] -> REQUEST GET http://localhost:3000/_next/static/chunks/main-app.js?v=1793236334683
[2026-10-29T01:12:15.030Z] -> REQUEST GET http://localhost:3000/_next/static/chunks/app-pages-internals.js
[2026-10-29T01:12:15.030Z] -> REQUEST GET http://localhost:3000/_next/static/chunks/app/page.js
[2026-10-29T01:12:15.031Z] -> REQUEST GET http://localhost:3000/_next/static/chunks/app/check/page.js
[2026-10-29T01:12:15.074Z] <- RESPONSE 200 GET http://localhost:3000/check | Body: <!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/css/app/layout.css?v=1793236334683" data-precedence="next_static/css/app/layout.css"/><link rel="preload" as="script" fetchPrior
[2026-10-29T01:12:15.227Z] <- RESPONSE 200 GET http://localhost:3000/_next/static/css/app/layout.css?v=1793236334683 | Body: /*!*************************************************************************************************************************************************************************************************************************************************************!*\
  !*** css ./node_modules/next/dist/buil
[2026-10-29T01:12:15.245Z] <- RESPONSE 200 GET http://localhost:3000/_next/static/chunks/webpack.js?v=1793236334683 | Body: /******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/
[2026-10-29T01:12:15.259Z] <- RESPONSE 200 GET http://localhost:3000/_next/static/chunks/app/page.js | Body: /*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select
[2026-10-29T01:12:15.262Z] <- RESPONSE 200 GET http://localhost:3000/_next/static/chunks/app/check/page.js | Body: /*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select
[2026-10-29T01:12:15.290Z] <- RESPONSE 200 GET http://localhost:3000/_next/static/chunks/app-pages-internals.js | Body: /*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select
[2026-10-29T01:12:16.738Z] [BROWSER CONSOLE info] %cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold
[2026-10-29T01:12:16.860Z] Clicking sample button...
[2026-10-29T01:12:17.460Z] <- RESPONSE 200 GET http://localhost:3000/_next/static/chunks/main-app.js?v=1793236334683 | Body: /*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select
[2026-10-29T01:12:17.469Z] [BROWSER CONSOLE error] Failed to load resource: the server responded with a status of 404 (Not Found)
[2026-10-29T01:12:17.565Z] Consent checked: true
[2026-10-29T01:12:17.565Z] Submitting check...
[2026-10-29T01:12:17.618Z] -> REQUEST POST http://localhost:3000/api/checks | Body: ------WebKitFormBoundarynhEbQA86hFAl0yPr
Content-Disposition: form-data; name="text"

Congratulations! You have been shortlisted for a 3-month remote Software Developer Internship at TechCorp India. Monthly stipend is ₹35,000. To confirm your seat and receive the training toolkit, pay a refundabl
[2026-10-29T01:12:17.627Z] Waiting for navigation to /check/...
[2026-10-29T01:12:18.080Z] -> REQUEST GET http://localhost:3000/check/77fcd793-e315-4e77-932f-11260cec923f?_rsc=iR_eTxzRgbrHPfap
[2026-10-29T01:12:18.081Z] <- RESPONSE 201 POST http://localhost:3000/api/checks | Body: {"checkId":"77fcd793-e315-4e77-932f-11260cec923f","status":"created"}
[2026-10-29T01:12:18.222Z] -> REQUEST GET http://localhost:3000/_next/static/chunks/app/check/%5Bid%5D/page.js
[2026-10-29T01:12:18.236Z] <- RESPONSE 200 GET http://localhost:3000/check/77fcd793-e315-4e77-932f-11260cec923f?_rsc=iR_eTxzRgbrHPfap | Body: <could not read body>
[2026-10-29T01:12:18.303Z] <- RESPONSE 200 GET http://localhost:3000/_next/static/chunks/app/check/%5Bid%5D/page.js | Body: /*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select
[2026-10-29T01:12:18.310Z] Navigated to check URL: http://localhost:3000/check/77fcd793-e315-4e77-932f-11260cec923f, checkId: 77fcd793-e315-4e77-932f-11260cec923f
[2026-10-29T01:12:18.313Z] DB check row after submit: {"id":"77fcd793-e315-4e77-932f-11260cec923f","status":"awaiting_confirmation","created_at":"2026-10-29T01:12:18.039Z","updated_at":"2026-10-29T01:12:18.054Z"}
[2026-10-29T01:12:18.313Z] Waiting for confirmation UI...
[2026-10-29T01:12:18.331Z] -> REQUEST GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f
[2026-10-29T01:12:18.332Z] -> REQUEST GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f
[2026-10-29T01:12:18.431Z] <- RESPONSE 200 GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f | Body: {"check":{"id":"77fcd793-e315-4e77-932f-11260cec923f","status":"awaiting_confirmation","currentRound":0,"language":"en","riskLevel":null,"score":null,"confidence":null,"failureReason":null,"createdAt":"2026-10-29T01:12:18.039Z","updatedAt":"2026-10-29T01:12:18.054Z","expiresAt":"2026-10-30T01:12:18.
[2026-10-29T01:12:18.477Z] <- RESPONSE 200 GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f | Body: {"check":{"id":"77fcd793-e315-4e77-932f-11260cec923f","status":"awaiting_confirmation","currentRound":0,"language":"en","riskLevel":null,"score":null,"confidence":null,"failureReason":null,"createdAt":"2026-10-29T01:12:18.039Z","updatedAt":"2026-10-29T01:12:18.054Z","expiresAt":"2026-10-30T01:12:18.
[2026-10-29T01:12:18.547Z] Confirmation UI loaded.
[2026-10-29T01:12:18.548Z] DB check row before clicking confirm: {"id":"77fcd793-e315-4e77-932f-11260cec923f","status":"awaiting_confirmation","created_at":"2026-10-29T01:12:18.039Z","updated_at":"2026-10-29T01:12:18.054Z"}
[2026-10-29T01:12:18.548Z] Clicking 'Confirm & Start Multi-Agent Check →' button (rapid double click to simulate user action)...
[2026-10-29T01:12:18.635Z] -> REQUEST POST http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/confirm | Body: {"texts":["Congratulations! You have been shortlisted for a 3-month remote Software Developer Internship at TechCorp India. Monthly stipend is ₹35,000. To confirm your seat and receive the training toolkit, pay a refundable security deposit of ₹3,500 to our HR coordinator upi: hr-techcorp@oksbi. Off
[2026-10-29T01:12:18.637Z] -> REQUEST POST http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/confirm | Body: {"texts":["Congratulations! You have been shortlisted for a 3-month remote Software Developer Internship at TechCorp India. Monthly stipend is ₹35,000. To confirm your seat and receive the training toolkit, pay a refundable security deposit of ₹3,500 to our HR coordinator upi: hr-techcorp@oksbi. Off
[2026-10-29T01:12:18.974Z] [BROWSER CONSOLE error] Failed to load resource: the server responded with a status of 409 (Conflict)
[2026-10-29T01:12:19.008Z] <- RESPONSE 409 POST http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/confirm | Body: {"code":"STATE_CONFLICT","message":"Confirmation not allowed for check in status 'investigating' (must be awaiting_confirmation)","details":{"status":"investigating"}}
[2026-10-29T01:12:21.646Z] DB check row 3s after click: {"id":"77fcd793-e315-4e77-932f-11260cec923f","status":"investigating","created_at":"2026-10-29T01:12:18.039Z","updated_at":"2026-10-29T01:12:18.793Z"}
[2026-10-29T01:12:28.342Z] -> REQUEST GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/stream
[2026-10-29T01:12:28.475Z] -> REQUEST GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/report
[2026-10-29T01:12:28.475Z] -> REQUEST GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/report
[2026-10-29T01:12:28.476Z] -> REQUEST GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/events?after=57
[2026-10-29T01:12:28.480Z] <- RESPONSE 200 GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/stream | Body: retry: 3000
data: {"type":"connected"}

id: 1
event: message
data: {"seq":1,"checkId":"77fcd793-e315-4e77-932f-11260cec923f","ts":"2026-10-29T01:12:18.044Z","round":0,"agent":null,"type":"stage","stage":"Extraction started","id":630}

id: 2
event: message
data: {"seq":2,"checkId":"77fcd793-e315-4e77
[2026-10-29T01:12:28.644Z] <- RESPONSE 200 GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/report | Body: {"report":{"checkId":"77fcd793-e315-4e77-932f-11260cec923f","riskLevel":"medium","score":55,"confidence":"high","scamTypeGuess":"unknown","language":"en","summary":"Cautionary indicators were identified in this opportunity (Registration, training, certificate, or security deposit fee demanded before
[2026-10-29T01:12:28.648Z] -> REQUEST GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f
[2026-10-29T01:12:28.657Z] <- RESPONSE 200 GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/events?after=57 | Body: {"events":[]}
[2026-10-29T01:12:28.755Z] <- RESPONSE 200 GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/report | Body: {"report":{"checkId":"77fcd793-e315-4e77-932f-11260cec923f","riskLevel":"medium","score":55,"confidence":"high","scamTypeGuess":"unknown","language":"en","summary":"Cautionary indicators were identified in this opportunity (Registration, training, certificate, or security deposit fee demanded before
[2026-10-29T01:12:28.803Z] -> REQUEST GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/report
[2026-10-29T01:12:28.834Z] <- RESPONSE 200 GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f | Body: {"check":{"id":"77fcd793-e315-4e77-932f-11260cec923f","status":"report_ready","currentRound":1,"language":"en","riskLevel":"medium","score":55,"confidence":"high","failureReason":null,"createdAt":"2026-10-29T01:12:18.039Z","updatedAt":"2026-10-29T01:12:28.302Z","expiresAt":"2026-10-30T01:12:18.039Z"
[2026-10-29T01:12:28.914Z] <- RESPONSE 200 GET http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/report | Body: {"report":{"checkId":"77fcd793-e315-4e77-932f-11260cec923f","riskLevel":"medium","score":55,"confidence":"high","scamTypeGuess":"unknown","language":"en","summary":"Cautionary indicators were identified in this opportunity (Registration, training, certificate, or security deposit fee demanded before
[2026-10-29T01:12:33.648Z] DB check row after 15s: {"id":"77fcd793-e315-4e77-932f-11260cec923f","status":"report_ready","created_at":"2026-10-29T01:12:18.039Z","updated_at":"2026-10-29T01:12:28.302Z"}
[2026-10-29T01:12:33.649Z] DB events count: 57
[2026-10-29T01:12:33.649Z] DB events sample: [{"seq":1,"type":"stage","agent":null,"status":null,"summary":"Extraction started"},{"seq":2,"type":"stage","agent":null,"status":null,"summary":"Extraction complete: 7 entities identified"},{"seq":3,"type":"stage","agent":null,"status":null,"summary":"investigating started"},{"seq":4,"type":"round","agent":null,"status":null,"summary":"round 1 started"},{"seq":5,"type":"agent_status","agent":"message_analyst","status":"started","summary":"Agent message_analyst started in round 1"},{"seq":6,"type":"agent_status","agent":"classifier_client","status":"started","summary":"Agent classifier_client started in round 1"},{"seq":7,"type":"agent_status","agent":"payment_entity","status":"started","summary":"Agent payment_entity started in round 1"},{"seq":8,"type":"agent_status","agent":"website_forensics","status":"started","summary":"Agent website_forensics started in round 1"}]
[2026-10-29T01:12:33.658Z] Current UI heading / text excerpt: 🛡️ Opportunity Verifier Check an Offer Scam Guides About & Privacy Verify Now Investigation Reference: 77fcd793... Opportunity Risk Assessment Status: REPORT READY ASSESSED RISK LEVEL MEDIUM RISK Risk Score 55/100 Confidence NaN% Cautionary indicators were identified in this opportunity (Registration, training, certificate, or security deposit fee demanded before or after selection; Direct selec
[2026-10-29T01:12:33.675Z] <- RESPONSE 200 POST http://localhost:3000/api/checks/77fcd793-e315-4e77-932f-11260cec923f/confirm | Body: <could not read body>
```

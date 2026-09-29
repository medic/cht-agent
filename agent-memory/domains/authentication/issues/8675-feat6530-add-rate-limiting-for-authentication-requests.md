---
id: cht-core-6530
category: feature
domain: authentication
domainFit: strong
issueNumber: 6530
issueUrl: https://github.com/medic/cht-core/issues/6530
title: Add rate limiting for authentication requests
lastUpdated: '2026-09-29'
summary: Authentication had no throttling, leaving the login form and HTTP Basic auth open to brute-force and credential-stuffing attacks. A rate-limit service (an in-memory `rate-limiter-flexible` limiter) and a global Express middleware now count failed attempts (401/429 responses) per client IP, username and password, and answer further credentialed requests with 429 Too Many Requests once a key has 10 failures within 10 seconds.
services:
  - api
techStack:
  - javascript
  - node.js
  - express
tags:
  - rate-limiting
  - login
  - brute-force-protection
  - security
  - middleware
  - throttling
related_workflows: []
source_pr: medic/cht-core#8675
source_sha: 1332879f0c73965687ae5dfe80373cde28b402d2
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/middleware/rate-limiter.js
  - api/src/services/rate-limit.js
  - api/src/controllers/login.js
  - api/src/auth.js
  - api/src/server-utils.js
  - api/src/routing.js
  - api/src/public/login/script.js
concepts:
  - rate limiting
  - brute-force protection
  - express middleware
  - authentication throttling
  - service/middleware separation
related_issues: []
stale: false
---

## Problem

API authentication (the login form endpoints and HTTP Basic auth on any API request) accepted unlimited repeated attempts from a client with no throttling, exposing them to brute-force and credential-stuffing attacks against user credentials.

## Root Cause

The login controller and auth routes lacked any request-counting or throttling layer — there was no mechanism to track or limit the number of authentication attempts per client.

## Solution

Introduced a dedicated rate-limit service (api/src/services/rate-limit.js) wrapping a `RateLimiterMemory` from the `rate-limiter-flexible` package (a new api dependency), configured with `keyPrefix: 'failed-login'` and 10 points per 10 seconds. Its keys are the request IP plus whichever of `req.body.user`, `req.body.password` and the HTTP Basic username/password are present; `isLimited(req)` is true when any key has no points left, and `consume(req)` spends a point on every key. The Express middleware (api/src/middleware/rate-limiter.js) is registered globally in api/src/routing.js (`app.use(rateLimiterMiddleware)`, ahead of the route handlers): a request that carries credentials and is limited gets 429, and every other request gets a `res.on('finish', ...)` handler that calls `consume` when the response status is 401 or 429, so only failed attempts are counted. JSON bodies are parsed per route (`app.postJson`), so that global pre-check only sees Basic credentials; the login handlers `post` (password login) and `tokenPost` (token login) in api/src/controllers/login.js call `rateLimitService.isLimited(req)` themselves before doing anything else. api/src/server-utils.js gained `rateLimited(req, res)`, which responds 429 `Too Many Requests`, and the login page script (api/src/public/login/script.js) now sends `Accept: application/json`, so that response comes back as JSON. The api/src/auth.js change only refactors `basicAuthCredentials`, which the service and middleware use to read Basic credentials.

## Code Patterns

Service + middleware separation: throttling logic lives in a reusable service (api/src/services/rate-limit.js) consumed both by a thin Express middleware (api/src/middleware/rate-limiter.js), registered globally with `app.use(rateLimiterMiddleware)` in api/src/routing.js, and by handlers that need the parsed request body (`const limited = await rateLimitService.isLimited(req);` then `return serverUtils.rateLimited(req, res);`). Penalise on the way out: because the middleware's `finish` hook spends points for every 401 or 429 response from any route, endpoints need no code of their own to have failures counted. On master the same `rateLimitService.isLimited(req)` pre-check also guards `resetPassword`, `oidcLogin` and `oidcAuthorize` in api/src/controllers/login.js.

## Design Choices

Rate-limit logic was factored into a standalone service rather than inlined in the login controller, so the global middleware and the login handlers share one limiter and it is unit-tested on its own. Only failures are counted — a point is spent only when the response is 401 or 429 — so successful logins do not use up the allowance. Keying on IP, username and password independently means guesses are throttled whether they come from one address, target one username, or reuse one password across usernames. The limiter is `RateLimiterMemory`, so counts are held in the API process's memory and are not persisted.

## Related Files

- api/src/middleware/rate-limiter.js
- api/src/services/rate-limit.js
- api/src/controllers/login.js
- api/src/routing.js
- api/src/auth.js
- api/src/server-utils.js
- api/src/public/login/script.js
- api/package.json

## Testing

Added Mocha unit tests for the middleware (api/tests/mocha/middleware/rate-limiter.spec.js) and service (api/tests/mocha/services/rate-limit.spec.js), extended the existing login controller unit tests (api/tests/mocha/controllers/login.spec.js) with 429 cases, added an integration test (tests/integration/api/rate-limit.spec.js) asserting that the 11th failed Basic-auth request from the same IP gets 429 and that requests get 401 again after 10 seconds, and restructured tests/integration/api/routing.spec.js. The WebdriverIO specs tests/e2e/default/login/login-logout.wdio-spec.js and tests/e2e/default/translations/enabled-languages.wdio-spec.js were adjusted (for example, the login spec now fetches the branding doc once in a `before` hook).

## Related Issues

- #6530: "Add rate limiting to authentication endpoints" — the issue this PR closes

## Domain Rationale

**Fit:** strong

The PR throttles failed credential checks — password and token logins plus HTTP Basic auth on any API route — to defend them against brute-force/credential-stuffing; protecting the auth/login flow is squarely the authentication domain.

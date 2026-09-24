---
id: cht-core-6530
category: feature
domain: authentication
domainFit: strong
issueNumber: 6530
issueUrl: https://github.com/medic/cht-core/issues/6530
title: Add rate limiting for authentication requests
lastUpdated: '2026-06-23'
summary: Authentication endpoints had no throttling, leaving login open to brute-force and credential-stuffing attacks. A rate-limit service plus Express middleware were added to cap repeated auth attempts and reject excess requests.
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

API authentication endpoints (login) accepted unlimited repeated attempts from a client with no throttling, exposing them to brute-force and credential-stuffing attacks against user credentials.

## Root Cause

The login controller and auth routes lacked any request-counting or throttling layer — there was no mechanism to track or limit the number of authentication attempts per client.

## Solution

Introduced a dedicated rate-limit service (api/src/services/rate-limit.js) encapsulating the throttling logic and an Express middleware (api/src/middleware/rate-limiter.js) that applies it. The middleware is wired into the auth/login flow via routing.js, login.js, auth.js, and server-utils.js so that excess authentication requests are rejected, and the login client script (public/login/script.js) was updated to surface the rate-limited response. A new dependency was added to api/package.json to back the limiter.

## Code Patterns

Service + middleware separation: throttling logic lives in a reusable service (api/src/services/rate-limit.js) consumed by a thin Express middleware (api/src/middleware/rate-limiter.js) mounted on auth routes in api/src/routing.js — a pattern reusable for guarding other sensitive endpoints.

## Design Choices

Rate-limit logic was factored into a standalone service rather than inlined in the login controller, keeping it testable in isolation and reusable across routes; the middleware applies it declaratively at the routing layer instead of scattering checks through controllers.

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

Added Mocha unit tests for the middleware (api/tests/mocha/middleware/rate-limiter.spec.js) and service (api/tests/mocha/services/rate-limit.spec.js), updated the login controller unit tests (api/tests/mocha/controllers/login.spec.js), added integration tests (tests/integration/api/rate-limit.spec.js and routing.spec.js), and updated WebdriverIO e2e login/logout coverage (tests/e2e/default/login/login-logout.wdio-spec.js).

## Related Issues

- #6530: add rate limiting for authentication requests

## Domain Rationale

**Fit:** strong

The PR adds throttling specifically to login/authentication endpoints to defend credential checks against brute-force/credential-stuffing — protecting the auth/login flow is squarely the authentication domain.

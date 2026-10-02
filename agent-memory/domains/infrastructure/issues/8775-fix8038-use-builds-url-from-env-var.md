---
id: cht-core-8038
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8038
issueUrl: https://github.com/medic/cht-core/issues/8038
title: Make the admin upgrade page use the builds URL that API is configured with (BUILDS_URL) instead of a hardcoded staging URL
lastUpdated: '2026-10-01'
summary: 'The admin upgrade page hardcoded the staging builds-server URL, so when API was started with a different BUILDS_URL the page could not list versions. API now returns its configured buildsUrl in the GET /api/v2/upgrade response and the admin controller uses it, falling back to the old default.'
services:
  - api
  - admin
techStack:
  - javascript
  - nodejs
  - angularjs
  - express
tags:
  - upgrade
  - environment-variable
  - builds-url
  - configuration
  - self-upgrade
  - env-var
related_workflows: []
source_pr: medic/cht-core#8775
source_sha: 4513f419d7db06d79baa3f38316b26e4be23b04f
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/upgrade.js
  - admin/src/js/controllers/upgrade.js
concepts:
  - environment-variable configuration
  - upgrade tooling
  - builds server URL
  - self-upgrade
  - configurable external service endpoint
related_issues: []
stale: false
---

## Problem

Before this PR, the admin upgrade page in `admin/src/js/controllers/upgrade.js` listed available versions from a hardcoded builds database, `const BUILDS_DB = 'https://staging.dev.medicmobile.org/_couch/builds_4';`. API already honoured a `BUILDS_URL` environment variable (`buildsUrl: BUILDS_URL || DEFAULT_BUILDS_URL`) and put `environment.buildsUrl` in the Content-Security-Policy `connectSrc` built in `api/src/routing.js`. So when API was launched with a different `BUILDS_URL`, the admin page still queried the default staging server, the CSP blocked that request, and issue #8038 reports the page showing "Error fetching available versions".

## Root Cause

The builds URL was configurable only on the server. The browser-side admin controller cannot read API's process environment, and before this PR API did not pass the configured value on, so the controller always opened `pouchDB(BUILDS_DB)` on the hardcoded constant.

## Solution

`upgradeInProgress` in `api/src/controllers/upgrade.js` (routed by `app.get('/api/v2/upgrade', upgrade.upgradeInProgress);` in `api/src/routing.js`) now responds with `res.json({ upgradeDoc, indexers, buildsUrl: environment.buildsUrl })`. In `admin/src/js/controllers/upgrade.js`, `getCurrentUpgrade` stores that value in `apiBuildsUrl`, the hardcoded constant is renamed `DEFAULT_BUILDS_URL`, and `loadBuilds` opens `pouchDB(apiBuildsUrl || DEFAULT_BUILDS_URL)`, so the page queries whichever builds server API is configured with.

## Code Patterns

When a browser-side admin page needs a server-side setting, return it from an API response the page already requests instead of duplicating the value in the client: `buildsUrl: environment.buildsUrl` in the GET /api/v2/upgrade response in `api/src/controllers/upgrade.js`, consumed in `admin/src/js/controllers/upgrade.js` with `apiBuildsUrl || DEFAULT_BUILDS_URL` as the fallback.

## Design Choices

The builds URL rides on the existing upgrade-status response rather than a new endpoint or a persisted setting. The admin controller keeps `DEFAULT_BUILDS_URL`, the same URL API uses as its default, as the fallback, so installs that never set `BUILDS_URL` behave as before.

## Related Files

- api/src/controllers/upgrade.js
- admin/src/js/controllers/upgrade.js
- api/tests/mocha/controllers/upgrade.spec.js
- api/tests/mocha/routing.spec.js
- admin/tests/unit/controllers/upgrade.spec.js

## Testing

The existing `admin/tests/unit/controllers/upgrade.spec.js` gained a 'should load builds from configured builds url' case asserting that `pouchDB` is opened with the `buildsUrl` returned by `/api/v2/upgrade`, and the default-path case now asserts `pouchDB` is opened with the staging default. `api/tests/mocha/controllers/upgrade.spec.js` asserts the `buildsUrl` field in the upgrade-status response, and `api/tests/mocha/routing.spec.js` now reads the admin constant as `DEFAULT_BUILDS_URL` when checking that API's CSP default builds URL includes it.

## Related Issues

- #8038: "Admin app fails to get releases when a different staging server is passed through ENV to API" — this draft's issue.

## Domain Rationale

**Fit:** strong

This changes the upgrade tooling — specifically how the app discovers available CHT builds for self-upgrade — by sourcing the builds-server URL from configuration. Upgrade lifecycle and build/deploy tooling are explicitly infrastructure concerns, not application behavior, so this is a strong fit.

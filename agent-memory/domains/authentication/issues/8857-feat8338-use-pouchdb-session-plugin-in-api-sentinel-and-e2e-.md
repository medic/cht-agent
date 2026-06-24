---
id: cht-core-8857
category: improvement
domain: authentication
domainFit: strong
issueNumber: 8857
issueUrl: https://github.com/medic/cht-core/issues/8857
title: Use PouchDB session plugin for cookie/session-based CouchDB authentication in api, sentinel, and e2e tests
lastUpdated: '2026-06-23'
summary: api and sentinel authenticated to CouchDB with basic auth, forcing CouchDB to re-hash credentials (PBKDF2) on every request; this switches them and the e2e/scalability/migration test utilities to cookie/session-based auth via a PouchDB session plugin so credentials are validated once per session and reused, cutting per-request auth overhead.
services:
  - api
  - sentinel
techStack:
  - pouchdb
  - couchdb
  - nodejs
  - javascript
tags:
  - session-authentication
  - cookie-auth
  - pouchdb-session-plugin
  - couchdb-auth
  - performance
related_workflows: []
source_pr: medic/cht-core#8857
source_sha: 61cf2bad3ee9c0ef2bda2b9d648970dbffad7d4c
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/db.js
  - sentinel/src/db.js
  - tests/utils/index.js
  - api/tests/integration/migrations/utils.js
  - scripts/get_users_meta_docs.js
  - scripts/conflicts/auto-resolve.js
  - scripts/conflicts/diff.js
  - tests/scalability/replicate-real-world-docs/add-docs-to-remote.js
concepts:
  - session-based authentication
  - cookie authentication (AuthSession)
  - PouchDB plugin architecture
  - CouchDB credential hashing (PBKDF2) cost
  - database connection authentication
related_issues: []
stale: false
---

## Problem

api and sentinel (plus several e2e, scalability, and migration test utilities) connected to CouchDB using HTTP basic authentication, sending username/password on every request. CouchDB validates basic-auth credentials by running PBKDF2 password hashing on each request, adding CPU/latency overhead to every database operation made by these services.

## Root Cause

The PouchDB clients in api/src/db.js and sentinel/src/db.js (and shared test utilities) used basic auth with no session/cookie mechanism, so CouchDB re-hashed the credentials with PBKDF2 on every single request instead of authenticating once and reusing a session.

## Solution

Added a PouchDB session-authentication plugin as a dependency (api/package.json, sentinel/package.json, root and lockfiles) and registered it on the PouchDB constructors in api/src/db.js and sentinel/src/db.js, and in the shared e2e/scalability/migration utilities (tests/utils/index.js, api/tests/integration/migrations/utils.js, scripts/*). Each client now performs a single CouchDB login to obtain a session cookie (AuthSession) and reuses it across subsequent requests, avoiding repeated password hashing.

## Code Patterns

Register the session plugin via PouchDB.plugin(...) and construct PouchDB instances configured to log in once and reuse the AuthSession cookie, instead of embedding basic-auth credentials per request; apply the identical pattern consistently across service db modules (api/src/db.js, sentinel/src/db.js) and shared test/script utilities (tests/utils/index.js).

## Design Choices

Cookie/session auth trades a small one-time login for much cheaper subsequent requests, versus basic auth that re-hashes credentials every request; using an off-the-shelf PouchDB session plugin avoids hand-rolling cookie handling. Reviewer (garethbowen) noted that even with CHT's low PBKDF2 iteration counts this should yield measurable api/sentinel performance gains, and suggested announcing the plugin in the PouchDB Slack channel for broader review.

## Related Files

- api/src/db.js
- sentinel/src/db.js
- api/package.json
- sentinel/package.json
- package.json
- api/tests/integration/migrations/utils.js
- tests/utils/index.js
- scripts/conflicts/auto-resolve.js
- scripts/conflicts/diff.js
- scripts/get_users_meta_docs.js
- tests/scalability/replicate-real-world-docs/add-docs-to-remote.js

## Testing

No new dedicated unit tests; the change updates shared e2e (tests/utils/index.js), integration migration (api/tests/integration/migrations/utils.js), and scalability test utilities to use the same session plugin, so existing e2e/integration/scalability suites exercise the new cookie-based auth path end to end.

## Related Issues

- #8338: use the PouchDB session plugin for cookie/session-based CouchDB authentication in api and sentinel

## Domain Rationale

**Fit:** strong

The PR replaces basic-auth (which forces CouchDB to re-hash credentials on every request) with cookie/session-based authentication via a PouchDB session plugin for api and sentinel's database connections; the authentication mechanism and session management are the entire substance of the change, which is canonically the authentication domain. It is application code (api/src/db.js, sentinel/src/db.js), not CI/build/deploy lifecycle, so it is not infrastructure.

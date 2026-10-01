---
id: cht-core-8338
category: improvement
domain: authentication
domainFit: strong
issueNumber: 8338
issueUrl: https://github.com/medic/cht-core/issues/8338
title: Use PouchDB session plugin for cookie/session-based CouchDB authentication in api, sentinel, and e2e tests
lastUpdated: '2026-09-29'
summary: The PouchDB clients in api and sentinel authenticated to CouchDB with HTTP Basic auth, so CouchDB ran PBKDF2 over the password on every request — a cost that grows with the iteration count that medic/cht-core#8338 set out to raise from 10. This registers the `pouchdb-session-authentication` plugin on those PouchDB constructors and on the ones in test utilities and scripts, so each client obtains a CouchDB session cookie and sends it on later requests instead of re-sending credentials. As of master the plugin is no longer registered anywhere; the PouchDB 9 upgrade (medic/cht-core#9988, 2025-06-03) removed it.
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
source_prs:
  - "medic/cht-core#8857"
  - "medic/cht-core#9030"
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
related_issues:
  - cht-core-9102
  - cht-core-9534
stale: true
---

## Problem

The PouchDB clients in api and sentinel (plus several e2e, scalability and migration test utilities and maintenance scripts) connected to CouchDB using HTTP basic authentication, sending username/password on every request. CouchDB validates basic-auth credentials by running PBKDF2 password hashing on each request, adding CPU/latency overhead to every database operation made by these clients — overhead that would grow in proportion if the PBKDF2 iteration count were raised, which is what issue #8338 ("Research increasing pbkdf2 iterations") asks for.

## Root Cause

The PouchDB clients in api/src/db.js and sentinel/src/db.js (and shared test utilities) used basic auth with no session/cookie mechanism, so CouchDB re-hashed the credentials with PBKDF2 on every single request instead of authenticating once and reusing a session.

## Solution

Added the `pouchdb-session-authentication` package (`^1.1.0`) as a dependency in the existing api/package.json, sentinel/package.json and root package.json (plus their lockfiles) and registered it with `PouchDB.plugin(require('pouchdb-session-authentication'))`, immediately after `pouchdb-adapter-http`, in api/src/db.js and sentinel/src/db.js, in the test utilities tests/utils/index.js and api/tests/integration/migrations/utils.js, in scripts/get_users_meta_docs.js, scripts/conflicts/auto-resolve.js and scripts/conflicts/diff.js, and in tests/scalability/replicate-real-world-docs/add-docs-to-remote.js. No PouchDB constructor call changed: per the plugin's README it takes the credentials already present in the database URL (or an `auth` option), generates and stores a session cookie per user + CouchDB server pair, appends it as a `Cookie` header to outgoing requests, and regenerates the cookie and retries when it expires. Only PouchDB HTTP traffic is affected; requests the services make outside PouchDB (for example with `request-promise-native`) are unchanged.

On master none of this remains: the dependency moved from api/ and sentinel/package.json to the root package.json in the #9106 dependency consolidation (`918d8e1b4`), and the PouchDB 9 upgrade (PR #9988, `d6db604c7`, 2025-06-03) then removed it from package.json together with every `PouchDB.plugin(require('pouchdb-session-authentication'))` registration listed above. The package now appears in the root package-lock.json only as a dependency of the `cht-conf` dev dependency.

## Code Patterns

Register the plugin with `PouchDB.plugin(require('pouchdb-session-authentication'))` after `pouchdb-adapter-http` (the plugin's README requires that order) and leave the constructors alone — clients that already pass credentials in the database URL switch to cookie auth without further changes. Apply the identical one-line registration to every PouchDB constructor that talks to CouchDB: service db modules (api/src/db.js, sentinel/src/db.js) and shared test/script utilities (tests/utils/index.js). (As of this PR; on master no code registers the plugin — see Solution.)

## Design Choices

Cookie/session auth trades a small one-time login for much cheaper subsequent requests, versus basic auth that re-hashes credentials every request; using an off-the-shelf PouchDB session plugin avoids hand-rolling cookie handling and keeps the change to one registration line per client. The driver is security rather than speed: issue #8338 notes CHT's password hashing used only 10 PBKDF2 iterations, and raising that count makes every Basic-auth request proportionally more expensive, so the high-volume service clients move to session cookies first (the plugin's README cites CouchDB's advice to use session cookies with high iteration counts).

## Related Files

- api/src/db.js
- sentinel/src/db.js
- api/package.json
- sentinel/package.json
- package.json
- api/tests/integration/migrations/utils.js
- tests/utils/index.js
- scripts/conflicts/auto-resolve.js (present at this PR's anchor; removed on master by the old-scripts cleanup, PR #10207)
- scripts/conflicts/diff.js (present at this PR's anchor; removed on master by the old-scripts cleanup, PR #10207)
- scripts/get_users_meta_docs.js
- tests/scalability/replicate-real-world-docs/add-docs-to-remote.js

## Testing

No new dedicated unit tests; the change updates shared e2e (tests/utils/index.js), integration migration (api/tests/integration/migrations/utils.js), and scalability test utilities to use the same session plugin, so existing e2e/integration/scalability suites exercise the new cookie-based auth path end to end.

## Related Issues

- #8338: "Research increasing pbkdf2 iterations" — the issue this PR references; moving service clients off per-request Basic auth is the prerequisite for raising the iteration count
- #9102: "Add PouchDb session plugin cht-core" — this PR's own tracking issue (Type: Technical issue), opened and closed on 2024-05-08, after the PR merged on 2024-04-18
- #9534: "Upgrade to latest version of PouchDB (current adapter)" — its PR #9988 removed the `pouchdb-session-authentication` registrations this PR added
- PR #9030: "chore(#8338): use CouchDb session in e2e tests requests" — follow-up for the same issue that made the `request()` helper in tests/utils/index.js POST to `/_session` once and reuse the `AuthSession` cookie instead of sending Basic auth; on master that helper sends an `Authorization: Basic` header again (`setRequestAuth`, since PR #9703 removed request-promise-native from the e2e tests)

## Domain Rationale

**Fit:** strong

The PR replaces basic-auth (which forces CouchDB to re-hash credentials on every request) with cookie/session-based authentication via a PouchDB session plugin for api's and sentinel's PouchDB connections to CouchDB, to make stronger password hashing affordable; the authentication mechanism and session management are the entire substance of the change. It is application code (api/src/db.js, sentinel/src/db.js), not CI/build/deploy lifecycle, so it is not infrastructure.

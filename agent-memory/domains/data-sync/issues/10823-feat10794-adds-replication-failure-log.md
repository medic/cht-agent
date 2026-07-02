---
id: cht-core-10794
category: feature
domain: data-sync
domainFit: strong
issueNumber: 10794
issueUrl: https://github.com/medic/cht-core/issues/10794
title: Add replication failure logging to the get-ids route and reorganize replication API services into a dedicated folder
lastUpdated: '2026-06-22'
summary: The existing replication-count log only recorded successful replications, so the most broken users (who could never replicate or log in) were never captured. This PR adds per-user per-month failure logging to the `/api/v1/replication/get-ids` route, plus a new endpoint to retrieve those failures for a given month.
services:
  - api
techStack:
  - javascript
  - nodejs
  - express
  - couchdb
  - mocha
tags:
  - replication
  - failure-logging
  - observability
  - logs-db
  - monitoring
  - service-refactor
  - offline-first
related_workflows:
  - observability
source_pr: medic/cht-core#10823
source_sha: 74b708b55132b03d3f6d365c263e7599bd25d63a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/replication-failure-log.js
  - api/src/services/replication/replication-failure-log.js
  - api/src/controllers/replication.js
  - api/src/services/replication/replication.js
  - api/src/services/replication/
  - api/src/routing.js
concepts:
  - offline-first replication
  - failure-path instrumentation / audit logging
  - per-user per-month log aggregation
  - capped detailed-entries with running total to bound document size
  - separate logs database in CouchDB
  - service-layer reorganization
related_issues: []
stale: false
---

## Problem

The replication-count log added in #6251 only recorded data when a replication request succeeded. Users with too many documents whose replication always failed — and who could therefore never log in — left no trace, which were exactly the broken users the team was trying to detect and guard against. Failures (server errors and client cancellations) on `/api/v1/replication/get-ids` were not captured anywhere.

## Root Cause

Logging was tied to the success path of the replication request, so the failure path of the get-ids route had no instrumentation. There was no mechanism to persist information about replications that never completed.

## Solution

Added replication failure logging to the `/api/v1/replication/get-ids` route, mirroring the existing setup on the initial-replication route. Each failure records timestamp, status code, duration, request ID, roles, and subjects count (when available). Failures are stored per-user per-month in the logs DB, capped at 50 detailed entries with a running total count, capturing both server errors and client cancellations. A new API endpoint returns replication failures for a given month (defaulting to the current month). All replication-related API services were also moved into a new dedicated `api/src/services/replication/` folder because the flat services list had grown unwieldy.

## Code Patterns

Per-user per-month log document in the logs DB with a capped detailed-entries array (50) plus a running total counter (api/src/services/replication/replication-failure-log.js) — bounds document growth while preserving an accurate aggregate count. Instrumenting the failure path to capture both server errors and client cancellations. New read endpoint defaulting to the current month (api/src/controllers/replication-failure-log.js).

## Design Choices

Cap detailed entries at 50 with a running total so the logs document stays bounded while the aggregate count stays accurate. Key logs per-user per-month for time-bounded, user-scoped analysis. Reuse the existing initial-replication failure-logging approach for consistency. Relocate replication services into a dedicated folder to tame the oversized services directory. Reviewer (jkuester) suggested also surfacing a total/distinct-user count via the /monitoring API as a follow-up.

## Related Files

- api/src/controllers/replication-failure-log.js
- api/src/services/replication/replication-failure-log.js
- api/src/controllers/replication.js
- api/src/services/replication/replication.js
- api/src/services/replication/replication-limit-log.js
- api/src/controllers/replication-limit-log.js
- api/src/routing.js
- api/tests/mocha/controllers/replication-failure-log.spec.js
- api/tests/mocha/services/replication/replication-failure-log.spec.js
- tests/integration/api/controllers/replication-failure-log.spec.js
- tests/integration/api/controllers/monitoring.spec.js

## Testing

Added mocha unit tests for the new controller (api/tests/mocha/controllers/replication-failure-log.spec.js) and service (api/tests/mocha/services/replication/replication-failure-log.spec.js), and relocated existing replication service/controller specs into the api/tests/mocha/.../replication/ structure. Added integration/e2e tests (tests/integration/api/controllers/replication-failure-log.spec.js) covering failure logging, accumulation, monthly separation, per-user separation, and the 50-entry cap. Updated monitoring and server integration specs to reflect the new routes.

## Related Issues

- #10794: feature request — replication-count log cannot capture users whose replication always fails (the issue this PR closes)
- #6251: original replication-count log that this PR extends to cover the failure path

## Domain Rationale

**Fit:** strong

The PR instruments the replication subsystem — the `/api/v1/replication/get-ids` route and the api/src/services/replication/* services that drive offline-first sync between clients and the server. Replication is squarely data-sync; the logging is observability of that subsystem (captured in relatedWorkflows), not a separate domain.

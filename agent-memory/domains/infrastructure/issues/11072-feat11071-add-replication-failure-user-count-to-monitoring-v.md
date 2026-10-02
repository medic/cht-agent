---
id: cht-core-11071
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 11071
issueUrl: https://github.com/medic/cht-core/issues/11071
title: Add replication failure user count to monitoring v2 API
lastUpdated: '2026-10-01'
summary: The monitoring v2 API exposed operational metrics but had no visibility into replication failures despite logging being added earlier. This PR surfaces a count of distinct users with at least one replication failure in the last `connected_user_interval` days (default 7) under `replication_failure.count`.
services:
  - api
techStack:
  - nodejs
  - javascript
  - couchdb
  - mocha
tags:
  - monitoring
  - observability
  - replication-failures
  - metrics
  - monitoring-v2
  - watchdog
related_workflows:
  - observability
source_pr: medic/cht-core#11072
source_sha: e8d030f94b0082c617c9ae43cd365caadae7b56f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/monitoring.js
  - api/src/services/monitoring.js
  - api/src/controllers/replication-failure-log.js
  - api/src/services/replication/replication-failure-log.js
  - ddocs/logs-db/logs/views/replication_failures/map.js
concepts:
  - monitoring/observability API endpoint
  - CouchDB map/reduce views (logs-db)
  - replication failure logging
  - rolling day-window aggregation
  - distinct-user count aggregation
related_issues: []
stale: false
---

## Problem

The `/api/v2/monitoring` endpoint provided operational metrics for CHT deployments but exposed no data about replication failures, even though replication failure logging had recently been added (PR #10823, `74b708b55`). Operators and monitoring tools (e.g. CHT Watchdog) had no aggregated, machine-readable signal for how many users were experiencing replication failures.

## Root Cause

Replication failure logs existed in the logs-db but were never aggregated or surfaced through the monitoring API, leaving a gap in observability for replication health. Before this PR each per-user, per-month `replication-fail-` log doc kept only the last `MAX_FAILURES` (50) failure entries plus a `total_failures` counter, with no per-day breakdown to count a time window from.

## Solution

The monitoring v2 response gains a `replication_failure.count` field: `jsonV2` in api/src/services/monitoring.js sets `jsonV1.replication_failure = { count: replicationFailuresUserCount }`. `captureFailure` in api/src/services/replication/replication-failure-log.js now also increments a per-day counter in the log doc's `daily_failures` object, keyed `YYYY-MM-DD`. The added view ddocs/logs-db/logs/views/replication_failures/map.js emits `[day, doc.user]` for every day key. In api/src/services/replication/replication-failure-log.js, `getUsersWithFailuresCount` queries `logs/replication_failures` from `startkey: [sinceKey]` (today minus `intervalDays`, inclusive) and counts distinct users; api/src/services/monitoring.js calls it as `getUsersWithFailuresCount(intervalDays)`. The window is the same `connected_user_interval` query parameter (default 7 days) that drives `connected_users.count`. If the query fails, the error is logged and the count is reported as `-1`, the fallback the other monitoring metrics use. In api/src/services/replication/replication-failure-log.js the same PR changed the placeholder recorded for failure-entry counters that were never set (`subjects_count`, `docs_count`, `unpurged_docs_count`) from the string `'unknown'` to `null` (`const UNKNOWN = null;`). It also documented `daily_failures` in the api/src/controllers/replication-failure-log.js OpenAPI comments.

## Code Patterns

This metric uses a service-plus-view shape: a dedicated service (`api/src/services/replication/replication-failure-log.js`) queries a logs-db view (`ddocs/logs-db/logs/views/replication_failures/map.js`) and returns an aggregate, which `api/src/services/monitoring.js` composes into the response served by `api/src/controllers/monitoring.js`. The neighbouring `replication_limit` and `connected_users` metrics instead query `db.medicLogs` directly inside `api/src/services/monitoring.js`.

## Design Choices

The window reuses `connected_user_interval` rather than adding a parameter, so `replication_failure.count` and `connected_users.count` follow the same `connected_user_interval` setting. Distinct users are counted (not raw failure events) to measure the breadth of impact. Per-day counts live on the existing per-user monthly log doc and are not capped, unlike the `failures` list, which keeps only the last `MAX_FAILURES` entries. The PR description says the count covers the current or previous calendar month; the merged code counts a rolling window of days instead.

## Related Files

- api/src/controllers/monitoring.js
- api/src/services/monitoring.js
- api/src/controllers/replication-failure-log.js
- api/src/services/replication/replication-failure-log.js
- ddocs/logs-db/logs/views/replication_failures/map.js
- api/tests/mocha/services/monitoring.spec.js
- api/tests/mocha/services/replication/replication-failure-log.spec.js
- tests/integration/api/controllers/monitoring.spec.js
- tests/integration/api/controllers/replication-failure-log.spec.js
- tests/utils/index.js

## Testing

The existing api/tests/mocha/services/monitoring.spec.js gained `v1 does not include replication_failure`, and api/tests/mocha/services/replication/replication-failure-log.spec.js gained a `getUsersWithFailuresCount` block (windowed startkey, interval argument, empty view, year boundary, error propagation) plus `daily_failures` bucket and lazy-initialisation cases; its `unknown` cases now expect `null`. In the existing tests/integration/api/controllers/monitoring.spec.js, the v2 expectation now includes a replication_failure count of 0, and another case seeds failure docs to check a count of 3 for the default 7-day window and 4 with `connected_user_interval=30`; tests/integration/api/controllers/replication-failure-log.spec.js checks the `daily_failures` buckets and `null` counters. tests/utils/index.js gained `clearReplicationFailureLogs`, which `revertDb` calls to delete `replication-fail-` docs from the logs db between tests.

## Related Issues

- PR #10823: "feat(#10794): adds replication failure log" — origin of the replication failure log service and its per-user log docs, which this PR extends with `daily_failures` and a distinct-user count.

## Domain Rationale

**Fit:** strong

The PR extends the operational monitoring v2 API (`/api/v2/monitoring`), an observability/infrastructure surface consumed by tools like CHT Watchdog, adding a new aggregated metric. It adds a per-day counter to the replication-failure log docs and a view over them, but changes no replication behavior, so the engineering is observability/infrastructure rather than data-sync.

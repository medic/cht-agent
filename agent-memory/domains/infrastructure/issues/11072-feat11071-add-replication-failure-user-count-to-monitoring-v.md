---
id: cht-core-11071
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 11071
issueUrl: https://github.com/medic/cht-core/issues/11071
title: Add replication failure user count to monitoring v2 API
lastUpdated: '2026-06-22'
summary: The monitoring v2 API exposed operational metrics but had no visibility into replication failures despite logging being added earlier. This PR surfaces a count of distinct users who hit replication failures in the current or previous calendar month under `replication_failure.count`.
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
  - calendar-month aggregation vs rolling window
  - distinct-user count aggregation
related_issues: []
stale: false
---

## Problem

The `/api/v2/monitoring` endpoint provided operational metrics for CHT deployments but exposed no data about replication failures, even though replication failure logging had recently been added (commit 74b708b). Operators and monitoring tools (e.g. CHT Watchdog) had no aggregated, machine-readable signal for how many users were experiencing replication failures.

## Root Cause

Replication failure logs existed in the logs-db but were never aggregated or surfaced through the monitoring API, leaving a gap in observability for replication health.

## Solution

Added a `replication_failure.count` field to the monitoring v2 response. The monitoring service queries the replication-failure-log service, which uses the `replication_failures` logs-db CouchDB view to count distinct users that hit replication failures within the current or previous calendar month, then folds that aggregate into the v2 payload.

## Code Patterns

New monitoring metrics follow the pattern: a dedicated service (`api/src/services/replication/replication-failure-log.js`) queries a logs-db view (`ddocs/logs-db/logs/views/replication_failures/map.js`) and returns an aggregate, which `api/src/services/monitoring.js` composes into the response served by `api/src/controllers/monitoring.js`.

## Design Choices

Counts are bucketed by calendar month (current or previous) rather than a rolling 30-day window, so the metric does not read artificially low in the first days after a month rollover. Distinct users are counted (not raw failure events) to measure the breadth of impact. A noted limitation from review (jkuester) is that calendar-month counts make it harder to monitor change-over-time via tools like Watchdog.

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

Mocha unit tests added/updated for the monitoring service and the replication-failure-log service, plus integration tests for the monitoring and replication-failure-log API controllers under tests/integration/api/controllers/. Shared test utilities (tests/utils/index.js) were extended to seed/assert the new replication-failure data.

## Related Issues

- #11071: Include replication failure data in monitoring APIs (feature request)

## Domain Rationale

**Fit:** strong

The PR extends the operational monitoring v2 API (`/api/v2/monitoring`), an observability/infrastructure surface consumed by tools like CHT Watchdog, adding a new aggregated metric. It only reads existing replication-failure logs to produce a metric and changes no replication behavior, so the engineering is observability/infrastructure rather than data-sync; the data-sync subject (replication) is captured via the observability related workflow.

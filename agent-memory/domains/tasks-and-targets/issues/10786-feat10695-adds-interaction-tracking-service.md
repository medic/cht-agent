---
id: cht-core-10695
category: feature
domain: tasks-and-targets
domainFit: weak
issueNumber: 10695
issueUrl: https://github.com/medic/cht-core/issues/10695
title: Add opt-in InteractionTrackingService to record CHW behavior on the tasks tab (list/task/group/filter events) for workflow analytics
lastUpdated: '2026-07-31'
summary: There was no way to measure whether recent tasks-tab improvements (filtering, priority sorting, search) actually improved task-list navigation for CHWs. This PR adds an opt-in InteractionTrackingService that buffers tasks-tab interaction events, persists them in batches to per-day local PouchDB databases, and aggregates them into a single per-(user,day,device) doc in the user-meta DB that replicates to the server for analysts to study.
services:
  - webapp
  - sentinel
techStack:
  - typescript
  - angular
  - pouchdb
  - couchdb
  - javascript
tags:
  - telemetry
  - observability
  - analytics
  - interaction-tracking
  - tasks
  - permissions
  - meta-db
  - pouchdb
related_workflows:
  - observability
source_pr: medic/cht-core#10786
source_sha: dcc8d00b0b8853fb54cff0e3998df41f4ade9f48
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/interaction-tracking.service.ts
  - webapp/src/ts/app.component.ts
  - webapp/src/ts/modules/tasks/tasks.component.ts
  - webapp/src/ts/services/rules-engine.service.ts
  - sentinel/src/schedule/replications.js
  - config/default/app_settings.json
  - webapp/src/js/bootstrapper/purger.js
concepts:
  - opt-in telemetry gated behind a permission (no-op when absent)
  - in-memory event buffering with batched flush to local storage
  - per-day local PouchDB partitioning of behavioral events
  - deferred aggregation of per-day DBs into the user-meta DB on next init()
  - idempotent per-(user,day,device) aggregate document IDs
  - replication to server via existing meta-DB sync rather than a new channel
  - lifecycle-driven flush triggers (threshold, route-leave, visibilitychange)
  - PII minimization by persisting unresolved titleKey instead of resolved task.title
related_issues: []
stale: false
---

## Problem

Recent tasks-page changes (filtering, sorting by priority, search) were intended to improve task-list navigation, but the team had no way to verify or quantify whether CHWs actually moved through their task queues more efficiently. No instrumentation existed to capture how users open, scroll, filter, and select tasks, and no storage/aggregation pipeline existed to surface that behavioral data to analysts.

## Root Cause

Feature gap rather than a defect: the tasks module emitted no interaction telemetry, and there was no client-side mechanism to buffer, persist, cap, aggregate, and replicate user-behavior events into a form analysts could query.

## Solution

Introduced an opt-in InteractionTrackingService gated by a new can_track_task_interactions permission (no-op for users without it). Tasks-module components (tasks, tasks-content, tasks-group, tasks-sidebar-filter) and rules-engine.service.ts record events (list opens/scrolls/leaves, task opens/form-submissions/completes/cancels, group navigation, filter usage). Events buffer in memory and flush in batches to a per-day local PouchDB (interaction-YYYY-MM-DD-{user}; `getCurrentDay()` zero-pads month and day with `padStart(2, '0')` and `DB_NAME_PATTERN` is `^interaction-\d{4}-\d{2}-\d{2}-.+$`) on a 50-event threshold, on leaving /tasks, and via a page-level visibilitychange listener wired in app.component. A per-day cap of 500 events drops extras silently. On each init(), any non-today per-day DB is aggregated into one type:'interaction-log' doc (_id: interaction-{date}-{user}-{deviceId}) in the user's meta DB and the per-day DB is destroyed; the aggregate replicates to the server-side user-meta DB through normal meta-DB sync. Sentinel replications.js and the bootstrapper purger were updated to recognise the new aggregate docs: both widened their `telemetry-`/`feedback-` doc-ID prefix predicate (`isTelemetryOrFeedback` -> `isReplicableDoc`; `isFeedbackOrTelemetryDoc` -> `isReplicableMetaDoc`) to also accept the `interaction-` prefix, so interaction-log docs replicate to users-meta and are purged locally afterwards. Neither touches the per-day local interaction databases.

## Code Patterns

Permission-gated no-op service: interaction-tracking.service.ts early-returns when the user lacks can_track_task_interactions. Buffer-and-batch-flush persistence to a per-day PouchDB with multiple flush triggers (count threshold + route-leave + visibilitychange in app.component.ts). Deterministic aggregate doc IDs keyed by (date, user, deviceId) make the write idempotent so the normal case is one meta-DB doc per user/day/device, with no day-spanning and no per-event rows; on a 409 conflict `putAggregate` falls back to an extra `...-conflicted-{Date.now()}` doc flagged `metadata.conflicted = true` rather than dropping the data; date components are zero-padded consistently across the _id and the DB-name regex used to find per-day DBs. PII minimization: rules-engine.service.ts:380 passes an unresolved titleKey through to recording call sites so the persisted payload never stores the resolved/translated task.title.

## Design Choices

Chose per-day local PouchDB plus deferred meta-DB aggregation over writing per-event docs into the meta store, keeping the meta DB small (one doc per user/day/device) and avoiding day-spanning rows. Made tracking opt-in behind a permission so it is off by default and privacy-respecting. Buffered in memory with batch writes to reduce IndexedDB churn, and deferred aggregation to the next init() so the active session is unaffected. Reused the existing meta-DB replication path instead of a bespoke channel. Stored the unresolved titleKey rather than the resolved title to avoid leaking PII, and capped per-day events at 500 to bound local storage.

## Related Files

- webapp/src/ts/services/interaction-tracking.service.ts
- webapp/src/ts/app.component.ts
- webapp/src/ts/modules/tasks/tasks.component.ts
- webapp/src/ts/modules/tasks/tasks-content.component.ts
- webapp/src/ts/modules/tasks/tasks-group.component.ts
- webapp/src/ts/modules/tasks/tasks-sidebar-filter.component.ts
- webapp/src/ts/modules/tasks/tasks.component.html
- webapp/src/ts/services/rules-engine.service.ts
- webapp/src/ts/services/integration-api.service.ts
- sentinel/src/schedule/replications.js
- config/default/app_settings.json
- webapp/src/js/bootstrapper/purger.js

## Testing

Added webapp/tests/karma/ts/services/interaction-tracking.service.spec.ts plus updated karma specs for app.component and the tasks, tasks-content, tasks-group, and tasks-sidebar-filter components; added sentinel replications.spec.js and mocha purger.spec.js coverage; added an end-to-end WebdriverIO spec (tests/e2e/default/tasks/interaction-tracking.wdio-spec.js) with supporting page-object and breadcrumbs-config updates. The feature was verified end-to-end on a local dev instance (logged in as a CHW, exercising the tasks tab and inspecting the per-day IndexedDB and meta DB), including PII narrowing on task.title and the deployment gap on can_track_task_interactions.

## Related Issues

- #10695: Implement task-selection telemetry to measure and quantify task-list navigation improvements (filtering, priority sorting, search)

## Domain Rationale

**Fit:** weak

The work spans a webapp telemetry service plus the sentinel replications.js/purger.js pipeline; task interactions are the tracked subject, but the mechanism is cross-cutting telemetry, so tasks-and-targets is the least-bad home rather than a principled fit.

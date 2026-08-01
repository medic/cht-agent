---
id: cht-core-9431
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 9431
issueUrl: https://github.com/medic/cht-core/issues/9431
title: Always aggregate and store targets and recalculate tasks automatically on state/document changes, with a 1s debounce
lastUpdated: '2026-08-01'
summary: Targets and tasks were only computed lazily when visiting specific pages, leaving them stale and unstored. The rules engine now always aggregates and persists targets and recalculates tasks automatically whenever rules state or documents change, with a 1s debounce to batch bursts of changes.
services:
  - webapp
techStack:
  - typescript
  - javascript
  - pouchdb
  - angular
  - rxjs
tags:
  - targets
  - tasks
  - rules-engine
  - target-aggregation
  - debounce
  - recalculation
  - change-feed
related_workflows:
  - task-scheduling
source_pr: medic/cht-core#9486
source_prs:
  - "medic/cht-core#9486"
  - "medic/cht-core#9549"
source_sha: dc3ef42ab8320ef8c951a4fa0e85ce11e2339879
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/index.js
  - shared-libs/rules-engine/src/target-state.js
  - shared-libs/rules-engine/src/rules-state-store.js
  - shared-libs/rules-engine/src/provider-wireup.js
  - shared-libs/rules-engine/src/pouchdb-provider.js
  - shared-libs/calendar-interval/src/index.js
  - webapp/src/ts/services/rules-engine.service.ts
  - webapp/src/ts/services/db-sync.service.ts
concepts:
  - rules engine
  - target aggregation and persistence
  - task recalculation
  - change-driven (reactive) recalculation
  - debouncing of change bursts
  - rules state store
  - offline client-side computation
related_issues:
  - cht-core-9552
  - cht-core-9714
stale: false
---

## Problem

Target aggregation and task recalculation only produced up-to-date results when the user navigated to certain pages (e.g. the targets/tasks views): a change-feed hook already marked contacts dirty as documents arrived, but nothing aggregated or persisted targets until a view asked for them. This left targets and tasks stale until a page visit, did not persist aggregated targets, and meant newly created or freshly synced documents did not update targets/tasks until the user navigated.

## Root Cause

The rules engine computed and aggregated targets/tasks lazily on page visit rather than reacting to rules-state changes or document updates, and aggregated target state was not stored. A change-feed hook already existed — `monitorChanges` subscribed through `ChangesService` under the key `mark-contacts-dirty` and called `rulesEngineCore.updateEmissionsFor(subjectIds)` for each matching change — but it fired once per document with no batching, aggregated target state was never persisted, and the task and target freshness paths ran two separate 120s debounces.

## Solution

Refactored the rules engine to always aggregate and store targets and to recalculate tasks automatically when the rules state changes or documents are updated. The webapp debounces the existing `ChangesService` `mark-contacts-dirty` subscription inside rules-engine.service.ts with `DEBOUNCE_CHANGE_MILLIS = 1000`, accumulating subject ids across a burst into a single `updateEmissionsFor` call so that bulk document downloads or creations do not kick off repeated heavy recalculation cycles; db-sync.service.ts is changed only to make `inProgressSync` an awaitable promise. Target/aggregation state is persisted via the pouchdb provider and rules-state-store.

## Code Patterns

Debounced, change-driven recalculation: subscribe to the CouchDB changes feed via `ChangesService` (key `mark-contacts-dirty`) inside rules-engine.service.ts and debounce (`DEBOUNCE_CHANGE_MILLIS = 1000`) before invoking the rules engine, then aggregate and persist target state. Key files: webapp/src/ts/services/db-sync.service.ts and webapp/src/ts/services/rules-engine.service.ts (change subscription + debounce), shared-libs/rules-engine/src/target-state.js and shared-libs/rules-engine/src/rules-state-store.js (aggregate + store targets), shared-libs/rules-engine/src/provider-wireup.js and pouchdb-provider.js (persistence wiring).

Dirty-tracking gates recomputation: rules-state-store.js decides when cached task/target emissions are dirty so target-state.js only recomputes when needed rather than on every change; calendar-interval/src/index.js computes period boundaries that invalidate periodic-target emissions when an interval turns over, and recalculation is coordinated off sync completion rather than by polling (PR #9549).

## Design Choices

Chose always-on automatic aggregation/storage and reactive recalculation over the prior lazy page-triggered approach so targets/tasks stay fresh and are available without navigating. Added a 1s debounce between receiving a change and triggering recalculation to coalesce bursts (sync downloads, bulk creation) and avoid repeated expensive recalculation cycles, trading a small latency for far less redundant computation. Kept the recalculation logic in the shared rules-engine lib so all consumers share one correct implementation, and drove recalculation from sync/data-change signals instead of periodic polling. A companion emission-recalculation rework was scoped and backported to the 4.13.x release line (PR #9549).

## Related Files

- shared-libs/rules-engine/src/index.js
- shared-libs/rules-engine/src/target-state.js
- shared-libs/rules-engine/src/rules-state-store.js
- shared-libs/rules-engine/src/provider-wireup.js
- shared-libs/rules-engine/src/pouchdb-provider.js
- shared-libs/calendar-interval/src/index.js
- webapp/src/ts/services/rules-engine.service.ts
- webapp/src/ts/services/db-sync.service.ts
- tests/e2e/default/targets/target-accuracy.wdio-spec.js
- tests/e2e/default/targets/config/target-accuracy-targets.js
- tests/e2e/default/targets/config/target-accuracy-tasks.js

## Testing

Updated unit tests across the rules engine (integration.spec.js, pouchdb-provider.spec.js, provider-wireup.spec.js, rules-state-store.spec.js, target-state.spec.js) and calendar-interval (test/index.js); added/updated webapp karma tests for db-sync.service and rules-engine.service; added e2e coverage via a new target-accuracy wdio spec with dedicated target/task config (target-accuracy-targets.js, target-accuracy-tasks.js) and adjusted purge, pregnancy-delivery, and replace-user e2e specs plus shared page objects and test utils.

## Related Issues

- #9431: always aggregate and store targets (the feature implemented by this PR)
- #9432: Merge ensureTaskFreshness and ensureTargetFreshness into single event — the companion performance issue folding the two 120s background refreshes into one

## Domain Rationale

**Fit:** strong

The PR refactors the rules engine's calculation, aggregation, and storage of targets plus recalculation of tasks — the canonical tasks-and-targets engine. The db-sync/change-feed hook is only the trigger mechanism, not the subject, so the functional domain is squarely tasks-and-targets.

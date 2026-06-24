---
id: cht-core-9486
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 9486
issueUrl: https://github.com/medic/cht-core/issues/9486
title: Always aggregate and store targets and recalculate tasks automatically on state/document changes, with a 1s debounce
lastUpdated: '2026-06-22'
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
related_issues: []
stale: false
---

## Problem

Target aggregation and task recalculation were only triggered when the user navigated to certain pages (e.g. the targets/tasks views). This left targets and tasks stale until a page visit, did not persist aggregated targets, and meant newly created or freshly synced documents did not update targets/tasks until the user navigated.

## Root Cause

The rules engine computed and aggregated targets/tasks lazily on page visit rather than reacting to rules-state changes or document updates, and aggregated target state was not stored. There was no hook from the sync/change feed into the rules engine to trigger recalculation when underlying documents changed.

## Solution

Refactored the rules engine to always aggregate and store targets and to recalculate tasks automatically when the rules state changes or documents are updated. The webapp wires the db-sync change feed into the rules-engine service so changes trigger recalculation, and a 1s debounce batches incoming changes so that bulk document downloads or creations do not kick off repeated heavy recalculation cycles. Target/aggregation state is persisted via the pouchdb provider and rules-state-store.

## Code Patterns

Debounced, change-driven recalculation: subscribe to the db-sync change feed and debounce (1s) before invoking the rules engine, then aggregate and persist target state. Key files: webapp/src/ts/services/db-sync.service.ts and webapp/src/ts/services/rules-engine.service.ts (change subscription + debounce), shared-libs/rules-engine/src/target-state.js and shared-libs/rules-engine/src/rules-state-store.js (aggregate + store targets), shared-libs/rules-engine/src/provider-wireup.js and pouchdb-provider.js (persistence wiring).

## Design Choices

Chose always-on automatic aggregation/storage and reactive recalculation over the prior lazy page-triggered approach so targets/tasks stay fresh and are available without navigating. Added a 1s debounce between receiving a change and triggering recalculation to coalesce bursts (sync downloads, bulk creation) and avoid repeated expensive recalculation cycles, trading a small latency for far less redundant computation.

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
- #9432: companion issue — recalculate tasks/targets automatically on document or state changes (debounced)

## Domain Rationale

**Fit:** strong

The PR refactors the rules engine's calculation, aggregation, and storage of targets plus recalculation of tasks — the canonical tasks-and-targets engine. The db-sync/change-feed hook is only the trigger mechanism, not the subject, so the functional domain is squarely tasks-and-targets.

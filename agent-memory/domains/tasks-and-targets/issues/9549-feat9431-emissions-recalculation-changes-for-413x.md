---
id: cht-core-9549
category: improvement
domain: tasks-and-targets
domainFit: strong
issueNumber: 9549
issueUrl: https://github.com/medic/cht-core/issues/9549
title: Rework rules-engine task/target emission recalculation for the 4.13.x release line
lastUpdated: '2026-06-22'
summary: Task and target emissions computed by the client-side rules engine were not always recalculated correctly when underlying data changed in 4.13.x. This PR reworks emission recalculation across the rules-engine shared lib and the webapp sync/rules-engine services so tasks and targets stay accurate.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - pouchdb
  - angular
tags:
  - rules-engine
  - emissions
  - recalculation
  - targets
  - tasks
  - target-state
  - calendar-interval
  - rules-state-store
related_workflows:
  - task-scheduling
source_pr: medic/cht-core#9549
source_sha: 045f9df05c5e87055a201cd2450ead835005671f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/target-state.js
  - shared-libs/rules-engine/src/rules-state-store.js
  - shared-libs/rules-engine/src/provider-wireup.js
  - shared-libs/rules-engine/src/pouchdb-provider.js
  - shared-libs/rules-engine/src/index.js
  - shared-libs/calendar-interval/src/index.js
  - webapp/src/ts/services/rules-engine.service.ts
  - webapp/src/ts/services/db-sync.service.ts
concepts:
  - rules engine emissions (task and target emissions)
  - emission recalculation / refresh triggering
  - rules state store dirty tracking and caching
  - target state accounting
  - calendar interval boundaries for periodic targets
  - client-side rules computation coupled to replication
related_issues: []
stale: false
---

## Problem

On the 4.13.x release line, task and target emissions produced by the client-side rules engine could become stale: when the underlying contacts/reports changed (for example across calendar-interval boundaries for periodic targets, or after data replicated from the server) the cached emissions were not always recomputed, so users saw inaccurate targets and tasks until a full refresh.

## Root Cause

The rules engine relies on the rules-state-store to decide when cached emissions are dirty and must be recomputed. The conditions that invalidated target emissions — calendar-interval handling, target accounting in target-state.js, and dirty tracking in rules-state-store.js / provider-wireup.js / pouchdb-provider.js — did not cover all cases that should invalidate emissions, and the webapp coupling between db-sync and the rules engine did not reliably trigger a recalculation after relevant changes synced.

## Solution

Reworked emission recalculation throughout the rules-engine shared lib (calendar-interval interval computation, target-state, rules-state-store dirty tracking, provider-wireup, pouchdb-provider) and adjusted the webapp rules-engine.service and db-sync.service so recalculation is triggered at the appropriate points relative to sync. Unit specs for each touched module and e2e target-accuracy coverage were added/updated alongside.

## Code Patterns

Dirty-tracking and emission caching in shared-libs/rules-engine/src/rules-state-store.js gate when target-state.js recomputes; calendar-interval/src/index.js computes period boundaries that invalidate periodic-target emissions; webapp coordinates recalculation off sync completion in db-sync.service.ts + rules-engine.service.ts rather than polling.

## Design Choices

Keep the recalculation logic in the shared rules-engine lib so all consumers share one correct implementation, and drive recalculation from sync/data-change signals instead of periodic polling. Scoped and backported specifically to the 4.13.x release line.

## Related Files

- shared-libs/rules-engine/src/target-state.js
- shared-libs/rules-engine/src/rules-state-store.js
- shared-libs/rules-engine/src/provider-wireup.js
- shared-libs/rules-engine/src/pouchdb-provider.js
- shared-libs/rules-engine/src/index.js
- shared-libs/calendar-interval/src/index.js
- webapp/src/ts/services/rules-engine.service.ts
- webapp/src/ts/services/db-sync.service.ts
- tests/e2e/default/targets/target-accuracy.wdio-spec.js
- tests/e2e/default/targets/config/target-accuracy-targets.js
- tests/e2e/default/targets/config/target-accuracy-tasks.js

## Testing

Updated unit specs for calendar-interval and the rules-engine modules (integration.spec.js, pouchdb-provider.spec.js, provider-wireup.spec.js, rules-state-store.spec.js, target-state.spec.js) and webapp karma specs for db-sync.service and rules-engine.service. Added/updated e2e wdio coverage: a target-accuracy suite with dedicated target and task config, plus purge, pregnancy-complete-a-delivery, and replace-user specs and supporting page objects/test utils.

## Related Issues

- #9431: emissions recalculation tracking issue implemented for the 4.13.x release line

## Domain Rationale

**Fit:** strong

The PR reworks how the client-side rules engine recalculates task and target emissions (target-state, calendar-interval, rules-state-store dirty tracking) — the rules engine is the core compute layer of the tasks-and-targets domain. db-sync.service.ts is touched only as a recalculation trigger, so data-sync stays secondary.

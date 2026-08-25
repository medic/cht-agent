---
id: cht-core-9552
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9552
issueUrl: https://github.com/medic/cht-core/issues/9552
title: Detect and rebuild rules-engine persisted target state written in the pre-#9486 shape after an upgrade
lastUpdated: '2026-08-07'
summary: After a CHT upgrade across the #9486 change to the persisted target-state shape, the rules engine rehydrated a blob written by the older build without checking that shape, and reading it crashed — `TypeError: Cannot convert undefined or null to object` at `Object.keys` in `aggregateStoredTargetEmissions`, the stack trace in issue #9552 — so tasks and targets failed to load after the upgrade. The trigger is the upgrade itself, not a change to target configuration. The fix detects the stale blob by its shape — `isStale` requires both a `targets` and an `aggregate` key, never reading the configured targets — and rebuilds state that fails the check; a follow-up migrates the same stale blob in place so the pre-existing interval-turnover write path can read it.
services:
  - webapp
techStack:
  - javascript
  - moment
  - pouchdb
  - webdriverio
tags:
  - rules-engine
  - targets
  - target-aggregates
  - target-state
  - stale-state
  - upgrade
  - interval-turnover
  - state-migration
  - state-store
  - cache-invalidation
related_workflows:
  - data-migration
source_pr: medic/cht-core#9553
source_prs:
  - "medic/cht-core#9553"
  - "medic/cht-core#9555"
  - "medic/cht-core#9569"
  - "medic/cht-core#9570"
source_sha: dc47c51e4660269c8daa3fd6e3ad08a4d37a7e8b
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/rules-state-store.js
  - shared-libs/rules-engine/src/target-state.js
concepts:
  - rules engine state persistence
  - target aggregation
  - state reconciliation across version upgrades
  - stale-cache detection / invalidation
  - calendar/reporting interval turnover
  - in-place persisted-state migration
related_issues: []
stale: false
---

## Problem

Following an upgrade past #9486 (issue #9552), the rules engine carried forward a persisted target state written in the older schema — a bare `{ [targetId]: ... }` map with no top-level `targets` or `aggregate` key. The post-upgrade code rehydrated that blob as-is, and the first tasks/targets load after the upgrade (reported on 4.12 → 4.13.x) crashed: `Object.keys(state.targets)` in `aggregateStoredTargetEmissions` threw `TypeError: Cannot convert undefined or null to object` — the stack trace in issue #9552 — leaving targets unavailable until the state was rebuilt.

The same bad shape also broke the interval-turnover write path: when the upgrade additionally crossed a reporting-interval boundary, the pre-existing `handleIntervalTurnover` (provider-wireup.js) read the persisted blob to aggregate and store the previous interval's target doc, hitting the same `Object.keys(state.targets)` crash — and the base fix's discard-and-rebuild alone would have thrown away the previous interval's emissions before that doc could be written (PR #9569, #9570).

## Root Cause

#9486 changed the persisted `targetState` shape from a bare `{ [targetId]: ... }` map to `{ targets: {...}, aggregate: {...} }`. `rules-state-store.load` rehydrated a blob written by a pre-#9486 build without checking that shape, so post-#9486 reads that assume the new shape hit a missing `targets` key — `Object.keys(state.targets)` threw on the first aggregation — and targets failed to load after the upgrade.

The interval-turnover facet is the same shape problem, not a detection gap: interval detection already existed before this work — `handleIntervalTurnover` in provider-wireup.js checks `moment(stateCalculatedAt).isBetween(currentInterval.start, currentInterval.end, ...)` and aggregates the previous interval via `calendarInterval.getInterval(monthStartDate, stateCalculatedAt)`, both present before PR #9569 — and both gone from master since #9718 removed the mechanism. What failed is that this path read the persisted blob directly, and a pre-#9486 bare map has no `targets` key, so `aggregateStoredTargetEmissions` threw. #9569 added no interval logic at all — one line in rules-state-store.js plus the shape-migration helpers in target-state.js that Code Patterns describes below; the rest is tests (PR #9569, #9570).

## Solution

Updated target-state.js and rules-state-store.js to detect that the persisted target state is in the pre-#9486 shape — the new `targetState.isStale` is `(state) => !state || !state.targets || !state.aggregate`, called from `load` as `targetState.isStale(state.targetState)` — and, when it fires, to mark the whole rules state stale so `provider-wireup.initialize` discards it and calls `rulesStateStore.build()`, rebuilding contact and target state from scratch. Added unit coverage for the stale-state scenario, and extended the existing e2e target-accuracy spec with a case titled 'should handle old format of the rules-state-store', which seeds a pre-#9486-format rules-state-store doc and confirms targets compute correctly after the upgrade.

A follow-up made the pre-existing interval-turnover write path work on the old shape. The migration is not triggered by comparing intervals: on every hydration `rules-state-store.load` runs the same shape check, and state failing it is migrated in place — emissions are preserved, not cleared, and simply rewrapped so `handleIntervalTurnover` can still read them. That function returns early when the state was last calculated inside the current interval; otherwise it aggregates against `calendarInterval.getInterval(monthStartDate, stateCalculatedAt)` — the interval the state belongs to, which is the one it then writes out — while staying compatible with documents written by older versions (PR #9569, #9570). (Symbols as of this PR's anchor: #9718 later removed the whole interval-turnover mechanism, so neither `handleIntervalTurnover` nor this call survives on master — see that draft.)

## Code Patterns

Validate the shape of persisted state on load: `target-state.isStale` checks only that the stored blob has both a `targets` and an `aggregate` key — it never reads the configured targets — and `rules-state-store.load` ORs that check with the `rulesConfigHash` mismatch to set `state.stale`, which forces a full rebuild rather than a partial repair.

The interval-turnover follow-up reuses the same shape check rather than an interval comparison: `rules-state-store.load` calls `state.targetState = targetState.migrateStaleState(state.targetState)` inside the existing `rulesConfigHash`/`isStale` branch, and `migrateStaleState` — added by the #9569/#9570 follow-up rather than by #9553 itself, and on master at target-state.js:124 — wraps a pre-#9486 bare targets map into `{ targets: <old map>, aggregate: {} }` when `isStale` is true. Emissions are preserved, not cleared; the wrap exists so `handleIntervalTurnover` in provider-wireup.js (the function has since been removed from master by #9718 — issue #9714 — which took out interval turnover altogether) can read the migrated state before the rebuild (PR #9569, #9570).

## Design Choices

Detecting the unusable persisted shape and rebuilding from scratch was chosen over trying to repair the blob: `load` returns true, `provider-wireup.initialize` calls `rulesStateStore.build()`, and all contact and target state is recomputed. One full rebuild after upgrade was accepted in exchange for guaranteed target accuracy.

The interval-turnover follow-up migrates the persisted blob in place but does not avoid the rebuild — `load` still sets `state.stale = true` on the very next line, so contact and task state are still discarded. The migration exists so the pre-#9486 blob is readable by `handleIntervalTurnover`, which writes the previous interval's target doc before `rulesStateStore.build()` runs, and it remains backwards compatible with state written by older versions (PR #9569, #9570).

## Related Files

- shared-libs/rules-engine/src/rules-state-store.js
- shared-libs/rules-engine/src/target-state.js
- shared-libs/rules-engine/test/rules-state-store.spec.js
- shared-libs/rules-engine/test/target-state.spec.js
- shared-libs/rules-engine/test/provider-wireup.spec.js
- tests/e2e/default/targets/target-accuracy.wdio-spec.js

## Testing

Added/updated unit tests in rules-state-store.spec.js and target-state.spec.js covering the stale-state-after-upgrade case (missing target aggregate), plus additions to the existing e2e WebdriverIO spec (tests/e2e/default/targets/target-accuracy.wdio-spec.js, modified not created) — the added case, 'should handle old format of the rules-state-store', seeds a pre-#9486-format blob rather than changing configuration. The #9569/#9570 unit coverage exercises the shape check (`isStale`), `migrateStaleState` rewrapping a bare targets map, and `commitTargetDoc` receiving the previous interval's aggregate ('should work with old format of the rules state store' in provider-wireup.spec.js) — turnover detection itself was pre-existing, and #9718 later removed `handleIntervalTurnover` from master entirely (PR #9569, #9570).

## Backports

The stale-state-after-upgrade fix was backported to the 4.13.x line (PR #9555, commit c8a7f13, cherry-pick of dc47c51). It was not backported to 4.1.x, whose tip (62aadbd, 4.1.2) predates the fix. The interval-turnover migration was also backported to 4.13.x (PR #9570).

## Related Issues

- #9552: `TypeError: Cannot convert undefined or null to object` at `Object.keys` in `aggregateStoredTargetEmissions` when loading tasks or targets for the first time after upgrading across #9486 (reported on 4.12 → 4.13.x) — the persisted pre-#9486 blob has no `targets` key, and the interval-turnover write path read the same blob

## Domain Rationale

**Fit:** strong

The change is entirely within the rules engine's target state handling (target-state.js, rules-state-store.js, and a target-accuracy e2e spec), and targets are canonically part of the tasks-and-targets domain. The 'after upgrade' trigger does not make it infrastructure — this is in-application rules-engine code, not operational lifecycle tooling.

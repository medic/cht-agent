---
id: cht-core-9552
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9552
issueUrl: https://github.com/medic/cht-core/issues/9552
title: Reconcile rules-engine persisted target state after an upgrade so newly configured target aggregates are not dropped
lastUpdated: '2026-08-01'
summary: After a CHT upgrade that changes target configuration, the rules engine's persisted target state became stale and omitted newly configured target aggregates, yielding inaccurate or missing targets. The fix detects the stale blob by its shape — `isStale` requires both a `targets` and an `aggregate` key, never reading the configured targets — and rebuilds state that fails the check; a related follow-up also migrates stale target state on reporting-interval turnover.
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

Following an upgrade past #9486 (issue #9552), the rules engine carried forward a persisted target state written in the older schema, in which the top-level `aggregate` key does not exist. The post-upgrade code rehydrated that blob as-is, so affected installs showed inaccurate or missing target values until the state was rebuilt.

A distinct facet of the same issue surfaces on reporting-interval turnover: when a target's reporting interval rolls over (e.g. the start of a new calendar month under the configured `monthStartDate`), the rules engine reused stale target state persisted from the previous interval, aggregating emissions from the prior period instead of resetting for the new interval and showing incorrect counts/percentages until the state was rebuilt (PR #9569, #9570).

## Root Cause

#9486 changed the persisted `targetState` shape from a bare `{ [targetId]: ... }` map to `{ targets: {...}, aggregate: {...} }`. `rules-state-store.load` rehydrated a blob written by a pre-#9486 build without checking that shape, so the missing top-level `aggregate` key was carried forward and target values came out inaccurate or absent after the upgrade.

For the interval-turnover facet, the persisted state stored target emissions without detecting that the reporting interval had changed between the cached state and the current computation time; on load after a turnover, the stale per-interval emissions were rehydrated and reused as-is rather than being re-scoped/reset for the now-current interval, so aggregation spanned the wrong period (PR #9569, #9570).

## Solution

Updated target-state.js and rules-state-store.js to detect that the persisted target state is in the pre-#9486 shape — the new `targetState.isStale` is `(state) => !state || !state.targets || !state.aggregate`, called from `load` as `targetState.isStale(state.targetState)` — and, when it fires, to mark the whole rules state stale so `provider-wireup.initialize` discards it and calls `rulesStateStore.build()`, rebuilding contact and target state from scratch. Added unit coverage for the stale-state scenario, and extended the existing e2e target-accuracy spec to confirm correct target values after the configuration change.

A follow-up added interval-turnover handling. It is not triggered by comparing intervals: on every hydration `rules-state-store.load` runs the same shape check, and state failing it is migrated in place — emissions are preserved, not cleared, and simply rewrapped so `handleIntervalTurnover` can read them against the active interval — while staying compatible with documents written by older versions (PR #9569, #9570).

## Code Patterns

Validate the shape of persisted state on load: `target-state.isStale` checks only that the stored blob has both a `targets` and an `aggregate` key — it never reads the configured targets — and `rules-state-store.load` ORs that check with the `rulesConfigHash` mismatch to set `state.stale`, which forces a full rebuild rather than a partial repair.

The interval-turnover follow-up reuses the same shape check rather than an interval comparison: `rules-state-store.load` calls `state.targetState = targetState.migrateStaleState(state.targetState)` inside the existing `rulesConfigHash`/`isStale` branch, and `migrateStaleState` — added by the #9569/#9570 follow-up rather than by #9553 itself, and on master at target-state.js:124 — wraps a pre-#9486 bare targets map into `{ targets: <old map>, aggregate: {} }` when `isStale` is true. Emissions are preserved, not cleared; the wrap exists so `handleIntervalTurnover` in provider-wireup.js (the function has since been removed from master by #9714, which took out interval turnover altogether) can read the migrated state before the rebuild (PR #9569, #9570).

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

Added/updated unit tests in rules-state-store.spec.js and target-state.spec.js covering the stale-state-after-upgrade case (missing target aggregate), plus additions to the existing e2e WebdriverIO spec (tests/e2e/default/targets/target-accuracy.wdio-spec.js, modified not created) validating that targets compute accurately after the configuration/upgrade scenario. The interval-turnover facet added/updated unit coverage in target-state.spec.js, rules-state-store.spec.js, and provider-wireup.spec.js exercising turnover detection and migration of stale target state into the current interval (PR #9569, #9570).

## Backports

The stale-state-after-upgrade fix was backported to the 4.13.x line (PR #9555, commit c8a7f13, cherry-pick of dc47c51). It was not backported to 4.1.x, whose tip (62aadbd, 4.1.2) predates the fix. The interval-turnover migration was also backported to 4.13.x (PR #9570).

## Related Issues

- #9552: rules-engine stale state after upgrade caused a missing target aggregate / inaccurate targets, and stale target state persisting across reporting-interval turnover

## Domain Rationale

**Fit:** strong

The change is entirely within the rules engine's target state handling (target-state.js, rules-state-store.js, and a target-accuracy e2e spec), and targets are canonically part of the tasks-and-targets domain. The 'after upgrade' trigger does not make it infrastructure — this is in-application rules-engine code, not operational lifecycle tooling.

---
id: cht-core-9552
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9552
issueUrl: https://github.com/medic/cht-core/issues/9552
title: Reconcile rules-engine persisted target state after an upgrade so newly configured target aggregates are not dropped
lastUpdated: '2026-07-16'
summary: After a CHT upgrade that changes target configuration, the rules engine's persisted target state became stale and omitted newly configured target aggregates, yielding inaccurate or missing targets. The fix reconciles stored target state against the current configuration so missing aggregates are backfilled rather than silently dropped; a related follow-up also migrates stale target state on reporting-interval turnover.
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

Following an upgrade (issue #9552), the rules engine carried forward a persisted target state that no longer matched the current target configuration. Newly configured target aggregates were absent from the stored state ('missing aggregate'), so affected installs showed inaccurate or missing target values until the state was rebuilt.

A distinct facet of the same issue surfaces on reporting-interval turnover: when a target's reporting interval rolls over (e.g. the start of a new calendar month under the configured `monthStartDate`), the rules engine reused stale target state persisted from the previous interval, aggregating emissions from the prior period instead of resetting for the new interval and showing incorrect counts/percentages until the state was rebuilt (PR #9569, #9570).

## Root Cause

The rules-state-store / target-state logic loaded and reused previously persisted target state without reconciling it against the currently configured targets. When configuration added a target aggregate that was not present in the stored state, the code did not account for the absent aggregate, leaving the target state stale and incomplete after the upgrade.

For the interval-turnover facet, the persisted state stored target emissions without detecting that the reporting interval had changed between the cached state and the current computation time; on load after a turnover, the stale per-interval emissions were rehydrated and reused as-is rather than being re-scoped/reset for the now-current interval, so aggregation spanned the wrong period (PR #9569, #9570).

## Solution

Updated target-state.js and rules-state-store.js to detect when the persisted target state is stale relative to the current target configuration and to backfill/initialize the missing target aggregates (rather than dropping them), so target state stays consistent across an upgrade. Added unit coverage for the stale-state scenario and an e2e target-accuracy spec to confirm correct target values after the configuration change.

A follow-up added interval-turnover handling: when the rules state store is hydrated and the persisted reporting interval no longer matches the current `CalendarInterval`, the stale target state is migrated in place — stored target emissions are re-scoped/reset to the active interval before aggregation — while staying compatible with documents written by older versions (PR #9569, #9570).

## Code Patterns

Reconcile persisted state against current configuration on load: in target-state.js, compare stored target aggregates with configured targets and initialize any missing entries before computing values; rules-state-store.js gates reuse of stored state on this consistency check instead of trusting the persisted blob verbatim.

Interval-turnover detection follows the same shape: compare the persisted reporting interval against the current `CalendarInterval` during state hydration in rules-state-store.js, and when they differ invoke a migration routine in target-state.js to clear/re-scope stale target emissions rather than reusing them directly (PR #9569, #9570).

## Design Choices

Backfilling only the missing target aggregates preserves already-computed rules state and avoids forcing a full, expensive rules-engine rebuild on every upgrade, while still guaranteeing target accuracy when configuration changes.

The interval-turnover fix likewise migrates the existing persisted state in place instead of forcing a full rules-engine rebuild, preserving unrelated contact/task state, avoiding a costly full recomputation, and remaining backwards compatible with state written by older versions (PR #9569, #9570).

## Related Files

- shared-libs/rules-engine/src/rules-state-store.js
- shared-libs/rules-engine/src/target-state.js
- shared-libs/rules-engine/test/rules-state-store.spec.js
- shared-libs/rules-engine/test/target-state.spec.js
- shared-libs/rules-engine/test/provider-wireup.spec.js
- tests/e2e/default/targets/target-accuracy.wdio-spec.js

## Testing

Added/updated unit tests in rules-state-store.spec.js and target-state.spec.js covering the stale-state-after-upgrade case (missing target aggregate), plus an e2e WebdriverIO spec (target-accuracy.wdio-spec.js) validating that targets compute accurately after the configuration/upgrade scenario. The interval-turnover facet added/updated unit coverage in target-state.spec.js, rules-state-store.spec.js, and provider-wireup.spec.js exercising turnover detection and migration of stale target state into the current interval (PR #9569, #9570).

## Backports

The stale-state-after-upgrade fix was backported to the 4.1.x line (PR #9555, cherry-pick of dc47c51) and to 4.13.x. The interval-turnover migration was also backported to 4.13.x (PR #9570).

## Related Issues

- #9552: rules-engine stale state after upgrade caused a missing target aggregate / inaccurate targets, and stale target state persisting across reporting-interval turnover

## Domain Rationale

**Fit:** strong

The change is entirely within the rules engine's target state handling (target-state.js, rules-state-store.js, and a target-accuracy e2e spec), and targets are canonically part of the tasks-and-targets domain. The 'after upgrade' trigger does not make it infrastructure — this is in-application rules-engine code, not operational lifecycle tooling.

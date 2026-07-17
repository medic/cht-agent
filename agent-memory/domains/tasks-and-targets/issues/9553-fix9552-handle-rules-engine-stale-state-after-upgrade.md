---
id: cht-core-9552
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9552
issueUrl: https://github.com/medic/cht-core/issues/9552
title: Reconcile rules-engine persisted target state after an upgrade so newly configured target aggregates are not dropped
lastUpdated: '2026-06-22'
summary: After a CHT upgrade that changes target configuration, the rules engine's persisted target state became stale and omitted newly configured target aggregates, yielding inaccurate or missing targets. The fix reconciles stored target state against the current configuration so missing aggregates are backfilled rather than silently dropped.
services:
  - webapp
techStack:
  - javascript
  - pouchdb
  - webdriverio
tags:
  - rules-engine
  - targets
  - target-aggregates
  - stale-state
  - upgrade
  - state-store
  - cache-invalidation
related_workflows:
  - data-migration
source_pr: medic/cht-core#9553
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
related_issues: []
stale: false
---

## Problem

Following an upgrade (issue #9552), the rules engine carried forward a persisted target state that no longer matched the current target configuration. Newly configured target aggregates were absent from the stored state ('missing aggregate'), so affected installs showed inaccurate or missing target values until the state was rebuilt.

## Root Cause

The rules-state-store / target-state logic loaded and reused previously persisted target state without reconciling it against the currently configured targets. When configuration added a target aggregate that was not present in the stored state, the code did not account for the absent aggregate, leaving the target state stale and incomplete after the upgrade.

## Solution

Updated target-state.js and rules-state-store.js to detect when the persisted target state is stale relative to the current target configuration and to backfill/initialize the missing target aggregates (rather than dropping them), so target state stays consistent across an upgrade. Added unit coverage for the stale-state scenario and an e2e target-accuracy spec to confirm correct target values after the configuration change.

## Code Patterns

Reconcile persisted state against current configuration on load: in target-state.js, compare stored target aggregates with configured targets and initialize any missing entries before computing values; rules-state-store.js gates reuse of stored state on this consistency check instead of trusting the persisted blob verbatim.

## Design Choices

Backfilling only the missing target aggregates preserves already-computed rules state and avoids forcing a full, expensive rules-engine rebuild on every upgrade, while still guaranteeing target accuracy when configuration changes.

## Related Files

- shared-libs/rules-engine/src/rules-state-store.js
- shared-libs/rules-engine/src/target-state.js
- shared-libs/rules-engine/test/rules-state-store.spec.js
- shared-libs/rules-engine/test/target-state.spec.js
- tests/e2e/default/targets/target-accuracy.wdio-spec.js

## Testing

Added/updated unit tests in rules-state-store.spec.js and target-state.spec.js covering the stale-state-after-upgrade case (missing target aggregate), plus an e2e WebdriverIO spec (target-accuracy.wdio-spec.js) validating that targets compute accurately after the configuration/upgrade scenario.

## Related Issues

- #9552: rules-engine stale state after upgrade caused a missing target aggregate / inaccurate targets

## Domain Rationale

**Fit:** strong

The change is entirely within the rules engine's target state handling (target-state.js, rules-state-store.js, and a target-accuracy e2e spec), and targets are canonically part of the tasks-and-targets domain. The 'after upgrade' trigger does not make it infrastructure — this is in-application rules-engine code, not operational lifecycle tooling.

---
id: cht-core-9552
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9552
issueUrl: https://github.com/medic/cht-core/issues/9552
title: Migrate stale target state on reporting interval turnover in the rules engine
lastUpdated: '2026-06-22'
summary: After a target's reporting interval turned over (e.g. a new month), the rules engine reused stale target state persisted from the previous interval. The fix migrates/resets the stored target state on interval change so aggregated targets reflect only the current interval.
services:
  - webapp
techStack:
  - javascript
  - pouchdb
tags:
  - rules-engine
  - target-state
  - interval-turnover
  - targets
  - state-migration
related_workflows: []
source_pr: medic/cht-core#9570
source_sha: e5a6b9d233e273158625e77bdc423c2a7d0273df
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/rules-state-store.js
  - shared-libs/rules-engine/src/target-state.js
concepts:
  - rules engine state management
  - target emission aggregation
  - reporting interval turnover
  - persisted-state migration
related_issues: []
stale: false
---

## Problem

When a target's reporting interval rolled over (such as the start of a new calendar month for monthly targets), the rules engine continued to surface stale target state carried over from the previous interval. Targets aggregated emissions from the prior period instead of resetting for the new interval, showing users incorrect counts/percentages until the rules engine state was rebuilt.

## Root Cause

The rules-state-store/target-state did not detect that the target reporting interval had changed between the persisted (cached) state and the current computation time. Persisted target emissions from the old interval were rehydrated and reused without being migrated or reset for the new interval, so aggregation spanned the wrong period.

## Solution

Added interval-turnover handling so that when the rules state store is hydrated and the current interval differs from the persisted one, the stale target state is migrated — stored target emissions are re-scoped/reset to the active interval — before aggregation. Changes span rules-state-store.js (turnover detection/wiring) and target-state.js (migration of stored emissions), with unit tests covering the turnover path.

## Code Patterns

Compare persisted reporting interval against the current interval during state hydration in rules-state-store.js, and when they differ invoke a migration routine in target-state.js to clear/re-scope stale target emissions rather than reusing them directly.

## Design Choices

Migrating the existing persisted state in place on interval turnover (instead of forcing a full rules-engine state rebuild) corrects target aggregation across the interval boundary while preserving other cached state and avoiding the cost of full recomputation.

## Related Files

- shared-libs/rules-engine/src/rules-state-store.js
- shared-libs/rules-engine/src/target-state.js
- shared-libs/rules-engine/test/provider-wireup.spec.js
- shared-libs/rules-engine/test/rules-state-store.spec.js
- shared-libs/rules-engine/test/target-state.spec.js

## Testing

Unit tests added/updated in target-state.spec.js, rules-state-store.spec.js, and provider-wireup.spec.js to exercise the interval-turnover migration and confirm stale target state is reset/re-scoped to the current interval.

## Related Issues

- #9552: Stale target state persisting across reporting interval turnover (fixed here; backported to 4.13.x)

## Domain Rationale

**Fit:** strong

The change is in the rules engine's target-state and rules-state-store source modules, correcting how targets are aggregated across reporting intervals. Targets are the core of the tasks-and-targets domain, and this is application computation logic (not app settings/config), so it is a strong fit.

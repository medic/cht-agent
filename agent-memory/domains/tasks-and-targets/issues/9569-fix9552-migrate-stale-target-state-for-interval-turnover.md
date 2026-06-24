---
id: cht-core-9569
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9569
issueUrl: https://github.com/medic/cht-core/issues/9569
title: Migrate stale target state on reporting-interval turnover in the rules-engine
lastUpdated: '2026-06-22'
summary: When a reporting interval turned over (e.g. the start of a new month), targets kept stale state persisted from the previous interval and showed incorrect values. The rules-state-store/target-state now detect the interval change and migrate the stale target state so targets recompute for the current interval.
services:
  - webapp
techStack:
  - javascript
  - moment
  - pouchdb
tags:
  - rules-engine
  - targets
  - target-state
  - interval-turnover
  - state-migration
  - reporting-interval
related_workflows: []
source_pr: medic/cht-core#9569
source_sha: fe795fb01bc52e9c74e7fd9988f1bcfeaf679193
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/rules-state-store.js
  - shared-libs/rules-engine/src/target-state.js
concepts:
  - rules-engine state persistence
  - calendar/reporting interval turnover
  - target state aggregation and migration
  - backwards-compatible in-place state migration
related_issues: []
stale: false
---

## Problem

After a reporting interval boundary (such as a new month under the configured monthStartDate), target widgets continued to reflect state persisted from the prior interval. Users saw incorrect target values/counts until the rules-engine state was otherwise rebuilt.

## Root Cause

The persisted rules-engine state stored target state without reconciling it against the current reporting interval. On load after an interval turnover, the stale per-interval target state was used as-is rather than being reset/recomputed for the now-current interval.

## Solution

Added migration logic in rules-state-store.js so that when persisted state is loaded and the stored reporting interval no longer matches the current calendar interval, the stale target state in target-state.js is migrated/reset, forcing targets to recompute for the current interval while remaining compatible with existing stored state.

## Code Patterns

Interval-turnover detection on state load (compare the persisted interval against the current CalendarInterval) paired with a migration step that resets stale per-interval target state — see shared-libs/rules-engine/src/rules-state-store.js and shared-libs/rules-engine/src/target-state.js.

## Design Choices

Migrate the existing persisted state in place on load instead of forcing a full rules-engine state rebuild, preserving unrelated (contact/task) state and avoiding a costly full recomputation while staying backwards compatible with documents written by older versions. The reviewer raised a minor stylistic preference but approved to expedite the patch.

## Related Files

- shared-libs/rules-engine/src/rules-state-store.js
- shared-libs/rules-engine/src/target-state.js
- shared-libs/rules-engine/test/rules-state-store.spec.js
- shared-libs/rules-engine/test/target-state.spec.js
- shared-libs/rules-engine/test/provider-wireup.spec.js

## Testing

Added/updated unit tests in target-state.spec.js, rules-state-store.spec.js, and provider-wireup.spec.js to cover interval-turnover detection and migration of stale target state into the current interval.

## Related Issues

- #9552: stale target state not migrated on reporting-interval turnover

## Domain Rationale

**Fit:** strong

The PR changes the rules-engine's target-state and rules-state-store to correctly compute targets across reporting-interval boundaries; targets and their interval-based aggregation are squarely in the tasks-and-targets domain. This is in-application rules-engine logic, not configuration or infrastructure.

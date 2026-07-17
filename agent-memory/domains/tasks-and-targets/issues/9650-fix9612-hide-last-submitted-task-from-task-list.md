---
id: cht-core-9612
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9612
issueUrl: https://github.com/medic/cht-core/issues/9612
title: Hide last submitted task immediately and run rules-engine and tasks-component debounces in parallel to speed up task list refresh
lastUpdated: '2026-06-22'
summary: After a debounce was added for marking contacts dirty, reloading tasks waited on two sequential debounce delays, making the task list slow to update and leaving the just-completed task visible. The fix emits the rules-engine change notification early so the debounces run in parallel and hides the last submitted task immediately after submission.
services:
  - webapp
techStack:
  - typescript
  - angular
  - rxjs
  - ngrx
  - webdriverio
tags:
  - debounce
  - task-list
  - rules-engine
  - performance
  - ui-responsiveness
  - e2e-test
related_workflows:
  - task-scheduling
  - form-submission
source_pr: medic/cht-core#9650
source_sha: 51da792b7bc0c6e9b212bc61a7ff0afe05fa440a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/reducers/tasks.ts
  - webapp/src/ts/services/rules-engine.service.ts
concepts:
  - debounce timing
  - rules engine
  - redux/ngrx reducer state management
  - optimistic UI update
  - rxjs change notification
related_issues: []
stale: false
---

## Problem

After a recent change introduced a debounce when marking contacts as dirty, reloading the task list incurred two sequential debounce delays — one in the rules engine and one in the tasks component — so the task list was slow to refresh after a task's action completed, and the just-submitted/completed task lingered visibly in the list. A previously single debounce had masked but not eliminated the issue. An e2e test was also slow because it read info from not-yet-rendered Angular elements.

## Root Cause

The rules engine debounced its dirty-contact change notification and the tasks component debounced its own reload, so the two debounces fired in series rather than concurrently, roughly doubling the delay before the task list updated. There was also no mechanism to remove a just-submitted task from the list until the full recompute/refresh completed.

## Solution

Emit the change notification early in rules-engine.service.ts so the rules-engine debounce and the tasks-component debounce run in parallel instead of sequentially; in tasks.ts immediately hide the last submitted task from the list after submission (it reappears on the next refresh if the action did not actually complete it); and optimize the WebdriverIO tasks page object to stop querying not-rendered Angular elements.

## Code Patterns

Parallelize chained debounces by emitting the change/notification signal before the debounced work begins (webapp/src/ts/services/rules-engine.service.ts). Optimistic UI removal in a reducer: hide the just-submitted task immediately and let the next authoritative refresh restore it if still pending (webapp/src/ts/reducers/tasks.ts).

## Design Choices

Rather than removing or shortening the debounces (which protects against excessive recomputation), both were kept but made concurrent by emitting the notification early. Optimistically hiding the last submitted task gives immediate user feedback while the rules engine recomputes; correctness is preserved because the task reappears on refresh if it was not truly completed.

## Related Files

- webapp/src/ts/reducers/tasks.ts
- webapp/src/ts/services/rules-engine.service.ts
- webapp/tests/karma/ts/reducers/tasks.spec.ts
- webapp/tests/karma/ts/services/rules-engine.service.spec.ts
- tests/page-objects/default/tasks/tasks.wdio.page.js

## Testing

Added/updated Karma unit tests for the tasks reducer (tasks.spec.ts) and the rules-engine service (rules-engine.service.spec.ts), and optimized the WebdriverIO tasks page object (tasks.wdio.page.js) to avoid reading not-rendered Angular elements. Manual testing videos are attached to the PR.

## Related Issues

- #9612: task list slow to refresh and last submitted task stays visible due to double (sequential) debounce

## Domain Rationale

**Fit:** strong

The PR changes task-list display behavior, the tasks reducer, and the rules-engine service that generates/refreshes tasks — squarely the tasks-and-targets domain. It concerns rules-engine service timing/behavior, not rules-engine configuration, so the config-related pitfall does not apply.

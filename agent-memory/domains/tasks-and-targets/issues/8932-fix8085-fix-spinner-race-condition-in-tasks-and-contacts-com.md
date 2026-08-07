---
id: cht-core-8085
category: bug
domain: tasks-and-targets
domainFit: weak
issueNumber: 8085
issueUrl: https://github.com/medic/cht-core/issues/8085
title: Fix spinner race condition that briefly flashed the 'No more tasks'/'No more people' end-of-list messages in tasks and contacts components
lastUpdated: '2026-08-07'
summary: The tasks and contacts list views momentarily displayed their end-of-list messages before rendering loaded items, due to a race between the loading flag dropping to false and the data refresh actually completing. Fixed by moving `this.loading = false;` out of the mid-function success and error paths into the `finally` block in both tasks.component.ts and contacts.component.ts, so the loading flag stays true until the whole load has settled.
services:
  - webapp
techStack:
  - typescript
  - angular
tags:
  - race-condition
  - loading-state
  - spinner
  - end-of-list-message
  - ui-rendering
  - tasks
  - contacts
related_workflows: []
source_pr: medic/cht-core#8932
source_sha: d46e632950c4d9d3093c921bceda65cef24ad873
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/tasks/tasks.component.ts
  - webapp/src/ts/modules/contacts/contacts.component.ts
concepts:
  - race condition
  - loading-state synchronization
  - Angular component lifecycle
  - spinner vs end-of-list message rendering
related_issues: []
stale: false
---

## Problem

When loading the tasks list — especially as an offline user with a large number of active tasks (~440) on a slow or CPU-throttled device — the left-hand list briefly displayed 'No more tasks' before the list actually rendered. The contacts component exhibited the same issue, momentarily showing 'No more people'. This pointed to a race condition in the tasks/contacts controllers, becoming more evident the slower the device.

## Root Cause

`this.loading = false;` was assigned partway through the load rather than at the end. In `tasks.component.ts` it ran immediately after `this.hasTasks = taskDocs.length > 0;`, i.e. before `hydrateEmissions`, the lineage lookup and the `setTasksList(...)` dispatch that follows it; in `contacts.component.ts` it ran inside the `.then` and `.catch` handlers rather than in `.finally`. Both end-of-list messages are gated on the has-items flag being true — `*ngIf="!errorStack && !loading && hasTasks && !tasksDisabled"` renders `task.list.complete` ('No more tasks') and `*ngIf="!error && !loading && hasContacts && !moreItems"` renders 'No more contacts' ('No more people') — not on an empty-list condition. So in the tasks case `loading` was already false and `hasTasks` already true while `tasksList` was still unpopulated, and the end-of-list message rendered above an empty `<ul>`.

## Solution

No new flags were introduced. The fix relocates the reset of the existing `loading` flag. In `tasks.component.ts`, `this.loading = false;` was deleted from the `try` body (where it ran immediately after `this.hasTasks = taskDocs.length > 0;`, i.e. before `hydrateEmissions`, the lineage lookup and `setTasksList`) and from the `catch` block, and a single `this.loading = false;` was added as the first statement of the existing `finally` block. `contacts.component.ts` got the identical treatment: removed from the `.then` and `.catch` handlers, added to `.finally`. `loading` therefore stays true until the entire load has settled. No template was changed.

## Code Patterns

Clear an async `loading` flag exactly once, in a `finally` block, rather than assigning it on each of the success and error paths — that way no path can clear it before the rest of the async work (hydration, lineage resolution, store dispatch) has finished. Both `tasks.component.ts` and `contacts.component.ts` apply this: `this.loading = false;` was deleted from the `try`/`catch` (resp. `.then`/`.catch`) bodies and added once to the `finally`.

## Design Choices

Chose the minimal fix — move the existing `loading = false;` assignment into the `finally` block — over introducing a new readiness flag, so neither the templates nor the component state shape had to change. Consolidating the reset in `finally` also removed the duplicated assignment that previously existed on both the success and the error path.

## Related Files

- webapp/src/ts/modules/tasks/tasks.component.ts
- webapp/src/ts/modules/contacts/contacts.component.ts

## Testing

Validated manually via before/after screen recordings demonstrating the race condition and its fix, reproduced by throttling CPU as an offline user with ~440 active tasks. No automated unit/e2e tests are noted.

## Related Issues

- #8085: Tasks list momentarily displays 'No more tasks' before rendering the loaded list — race condition in the tasks controller, more evident on slow/throttled devices and with many tasks

## Domain Rationale

**Fit:** weak

The race-condition fix touches tasks.component.ts and contacts.component.ts equally; the originating issue is about the tasks list, so tasks-and-targets is the least-bad home for a cross-component UI fix.

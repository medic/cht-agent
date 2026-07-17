---
id: cht-core-8085
category: bug
domain: tasks-and-targets
domainFit: weak
issueNumber: 8085
issueUrl: https://github.com/medic/cht-core/issues/8085
title: Fix spinner race condition that briefly flashed 'No more tasks'/'No more people' empty states in tasks and contacts components
lastUpdated: '2026-06-23'
summary: The tasks and contacts list views momentarily displayed empty-state messages before rendering loaded items, due to a race between the loading flag dropping to false and the data refresh actually completing. Added explicit tasksReady/contactsReady flags set only at true load completion to gate the spinner and empty-state display.
services:
  - webapp
techStack:
  - typescript
  - angular
tags:
  - race-condition
  - loading-state
  - spinner
  - empty-state
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
  - spinner vs empty-state rendering
related_issues: []
stale: false
---

## Problem

When loading the tasks list — especially as an offline user with a large number of active tasks (~440) on a slow or CPU-throttled device — the left-hand list briefly displayed 'No more tasks' before the list actually rendered. The contacts component exhibited the same issue, momentarily showing 'No more people'. This pointed to a race condition in the tasks/contacts controllers, becoming more evident the slower the device.

## Root Cause

During component initialization there was a momentary state where the `loading` flag was already false but `refreshTasks` (or the contacts load) had not yet completed, so `hasTasks`/contacts were still false. The template's empty-state condition (not loading + no items) evaluated true in that gap, flashing the 'No more tasks'/'No more people' message before the items populated.

## Solution

Introduced dedicated boolean readiness flags — `tasksReady` in the tasks component and `contactsReady` in the contacts component — initialized to false and set to true only at the very end of refreshTasks / when contacts are fully loaded. The view gates spinner visibility and the empty-state message on these flags, synchronizing the UI with actual data-load completion rather than the prematurely-cleared `loading` flag.

## Code Patterns

Gate empty-state/spinner rendering on a dedicated 'ready' flag set at the true completion point of an async load (tasksReady set at end of refreshTasks in tasks.component.ts; contactsReady set when contacts fully load in contacts.component.ts) instead of relying on the inverse of a `loading` flag — this closes the window between loading=false and data-populated.

## Design Choices

Chose to add a separate readiness flag rather than reuse the existing `loading` flag, because `loading` was cleared before the data refresh resolved, creating the race window. An explicit completion flag deterministically signals when the view can be rendered, avoiding the empty-state flash without restructuring the async load.

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

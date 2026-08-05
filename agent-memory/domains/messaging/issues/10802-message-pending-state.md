---
id: cht-core-10802
category: bug
domain: messaging
subDomain: scheduled-tasks
issueNumber: 10802
issueUrl: https://github.com/medic/cht-core/issues/10802
title: Message getting sent to pending state even after it is sent
lastUpdated: '2026-07-30'
summary: Fixed scheduled task processing to check each task's `state` before adding messages to the pending queue, preventing duplicate SMS sends when a document has multiple tasks sharing a due date.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
source_pr: medic/cht-core#10803
source_prs:
  - "medic/cht-core#10803"
  - "medic/cht-core#10811"
source_sha: 6a5867bb8b30d7e8bfb25187aabe44f6ac11a4c0
related_issues:
  - cht-core-10428
---

## Problem

Messages were being repeatedly sent to pending state (up to every 5 minutes for 7 days) when a document had multiple `scheduled_tasks` with the same due date. This caused:

- Community Health Workers receiving the same SMS message up to ~2,016 times in 7 days
- SMS costs spiking dramatically (up to 1,900 messages per instance over 7 days)
- User notification fatigue and confusion
- Affected all CHT instances from version 3.x through 5.1.0

## Root Cause

The scheduled task processing logic in `shared-libs/transitions/src/schedule/due_tasks.js` was:

1. Checking for tasks with the same due date but NOT considering their processing status
2. When a document had multiple `scheduled_tasks` with identical due dates and one was stuck in `scheduled` state, the system continuously added already-processed messages back to the pending queue
3. Created a feedback loop where the same message was resent every processing cycle (every 5 minutes) regardless of its current status

The code only checked the task's computed due value (`task.due || task.timestamp || doc.reported_date`) against the collected due dates, without checking whether the task had moved to a different `state`. More precisely, the view vouches for one task while the update loop acts on all of them: `execute()` queries `messages_by_state` with `startkey`/`endkey` keyed on `['scheduled', due]`, so only still-scheduled tasks are returned; `processBatch` groups those rows by document and collects their due values into a single per-document `dueDates` list; and `updateScheduledTasks` then iterates every entry in `doc.scheduled_tasks`, promoting any whose computed due value appears in that list. A task that had already moved out of `scheduled` was therefore never returned by the view at all. It was reached because it shared a due date with a still-scheduled sibling on the same document, which is why the fix is a per-task state guard inside that loop rather than a change to the view or the query (PR #10803, PR #10811).

## Solution

Modified the task processing logic to check BOTH the due date AND the task state before adding messages to the pending queue:

1. Added a state check to filter tasks: only process tasks in `scheduled` state
2. Prevents already-processed messages from being re-queued
3. Ensures each task is processed only once per due date window

The key change was an early return that skips any task not still in the `scheduled` state, added at the top of the `doc.scheduled_tasks.forEach` callback in `updateScheduledTasks`:
```javascript
const SCHEDULED_STATE = 'scheduled';
// ...
doc.scheduled_tasks.forEach(task => {
  // only process tasks that are still in 'scheduled' state - skip tasks that have already
  // progressed to other states (e.g. pending, sent, delivered) to prevent re-sending
  if (task.state !== SCHEDULED_STATE) {
    return;
  }
  // ...
});
```

The fix is a single guard: an early `return` that skips any `scheduled_task` whose `state` is not `'scheduled'`, so only still-scheduled tasks can be transitioned to `'pending'`. It landed twice as byte-identical patches, each reaching a different set of release lines: PR #10803 (6a5867bb) on master and 5.2.x, and PR #10811 (b87a025f), the cherry-pick that carries it onto 5.1.x. There is no second, separate guard.

## Code Patterns

- Always check the task `state` alongside due dates when processing scheduled tasks
- Use proper state management to prevent reprocessing of completed tasks
- Filter tasks by the computed due value (`task.due || task.timestamp || doc.reported_date`) AND the `task.state` field — a due task no longer in the `scheduled` state is skipped rather than reprocessed
- Pattern: `if (task.state !== SCHEDULED_STATE) { return; }` as the first statement in the `doc.scheduled_tasks.forEach` callback - skip any task not still in the `'scheduled'` state before the due-date comparison runs
- File: `shared-libs/transitions/src/schedule/due_tasks.js` contains the core scheduling logic
- File: `shared-libs/transitions/test/unit/due_tasks.js` contains unit tests
- The fix prevents SMS/notification spam by properly managing task state transitions

## Design Choices

Chose to fix at the library level (`shared-libs/transitions`) rather than in individual service implementations because:
- The issue was in the core scheduling mechanism used across multiple CHT services
- Ensures consistent behavior across all implementations
- Prevents similar issues in other parts of the system that use the same scheduling library
- Single fix point reduces maintenance burden

## Related Files

- shared-libs/transitions/src/schedule/due_tasks.js
- shared-libs/transitions/test/unit/due_tasks.js
- tests/integration/sentinel/schedules/due-tasks.spec.js (sentinel integration coverage; PR #10803, PR #10811)

## Testing

- Added integration test to verify that only scheduled tasks are processed in each window
- Test simulates multiple tasks with same due date and different statuses
- Verified that processed tasks don't get re-added to pending queue
- Added a sentinel integration test case (+69 lines) to the pre-existing `tests/integration/sentinel/schedules/due-tasks.spec.js` asserting scheduled_tasks are only updated to `pending` when still in the `scheduled` state and left untouched otherwise (PR #10803, PR #10811)

## Related Issues

- #10428: Send message state clearing (related improvement)

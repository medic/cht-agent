---
id: cht-core-10802
category: bug
domain: messaging
subDomain: scheduled-tasks
issueNumber: 10802
issueUrl: https://github.com/medic/cht-core/issues/10802
title: Message getting sent to pending state even after it is sent
lastUpdated: 2026-04-02
summary: Fixed scheduled task processing to check task status before adding messages to pending queue, preventing duplicate SMS sends when documents have multiple tasks with same due date.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
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

The code only checked `due_date` without checking if the task was already processed or in a different state.

## Solution

Modified the task processing logic to check BOTH the due date AND the task status before adding messages to the pending queue:

1. Added status check to filter tasks: only process tasks in `scheduled` state
2. Prevents already-processed messages from being re-queued
3. Ensures each task is processed only once per due date window

The key change was adding a status filter:
```javascript
if (task.status === 'scheduled' && isDue(task.due_date)) {
  // process task
}
```

## Code Patterns

- Always check task status alongside due dates when processing scheduled tasks
- Use proper state management to prevent reprocessing of completed tasks
- Filter tasks by both `due_date` and `status` fields to avoid duplicate processing
- Pattern: `if (task.status === 'scheduled' && isDue(task.due_date))` - process only scheduled tasks that are actually due
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
- api/src/controllers/scheduled_tasks.js
- sentinel/src/schedule/task-processor.js

## Testing

- Added integration test to verify that only scheduled tasks are processed in each window
- Test simulates multiple tasks with same due date and different statuses
- Verified that processed tasks don't get re-added to pending queue
- Edge case testing for tasks with null/undefined status fields

## Related Issues

- #10428: Send message state clearing (related improvement)
- #10754: Scheduled task duplicate processing (similar issue)
- Multiple issues related to scheduled task processing and state management

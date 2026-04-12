---
id: cht-core-10802
category: bug
domain: messaging
subDomain: scheduled-tasks
issueNumber: 10802
issueUrl: https://github.com/medic/cht-core/issues/10802
title: Message getting sent to pending state even after it is sent
lastUpdated: 2026-04-12
summary: Messages were being repeatedly sent to pending state (up to every 5 minutes for 7 days) when documents had multiple scheduled_tasks with the same due date, causing SMS spam and potential user notification fatigue.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

Community Health Workers were receiving the same SMS message repeatedly - up to 2,016 times in a 7-day period - when a patient document contained multiple scheduled tasks with the same due date. This happened because the system was incorrectly reprocessing already-sent messages, putting them back into the pending queue every 5 minutes. The issue affected all CHT instances from version 3.x through 5.1.0 and caused SMS costs to spike dramatically (up to 1,900 messages per instance over 7 days).

## Root Cause

The scheduled task processing logic in `shared-libs/transitions/src/schedule/due_tasks.js` was checking for tasks with the same due date but not considering their processing status. When a document had multiple `scheduled_tasks` with identical due dates and one was stuck in a scheduled state, the system would continuously add already-processed messages back to the pending queue. This created a feedback loop where the same message would be resent every processing cycle regardless of its current status.

## Solution

Modified the task processing logic to check both the due date AND the task status before adding messages to the pending queue. The fix ensures that only tasks in `scheduled` state are processed in each window, preventing already-processed messages from being re-queued. The key change was adding a status check to filter out tasks that had already been processed or were in other states.

## Code Patterns

- Always check task status alongside due dates when processing scheduled tasks
- Use proper state management to prevent reprocessing of completed tasks
- Filter tasks by both `due_date` and `status` fields to avoid duplicate processing
- Pattern: `if (task.status === 'scheduled' && isDue(task.due_date))` - process only scheduled tasks that are actually due
- File: `shared-libs/transitions/src/schedule/due_tasks.js` contains the core scheduling logic
- The fix prevents SMS/notification spam by properly managing task state transitions

## Design Choices

Chose to fix at the library level (`shared-libs/transitions`) rather than in individual service implementations because the issue was in the core scheduling mechanism used across multiple CHT services. This approach ensures consistent behavior across all implementations and prevents similar issues in other parts of the system that use the same scheduling library.

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

- #10803: Implementation PR that contains the actual fix and tests
- #10729: Another messaging-related issue in smsparser.js
- Multiple issues related to scheduled task processing and state management
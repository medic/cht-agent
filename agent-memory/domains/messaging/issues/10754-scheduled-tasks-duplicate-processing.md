---
id: cht-core-10754
category: bug
domain: messaging
subDomain: scheduled-tasks
issueNumber: 10754
issueUrl: https://github.com/medic/cht-core/issues/10754
title: Scheduled task duplicate processing when documents have multiple tasks with same due date
lastUpdated: 2026-04-12
summary: When patient documents contained multiple scheduled tasks with identical due dates, the system was processing the same task multiple times, causing duplicate messages and notification spam.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

Community Health Workers were receiving duplicate reminder messages for the same appointment or task. When a patient document had multiple scheduled tasks with the same due date (like different types of follow-ups), the system would process each task independently, resulting in multiple identical messages being sent. This caused confusion and notification fatigue for users.

## Root Cause

The scheduled task processing logic was iterating through all tasks without properly handling duplicate due dates. Each task was treated as independent, even when they referred to the same logical event. The processing queue didn't have deduplication logic, so tasks with identical due dates would all be added to the processing queue in each cycle.

This created a cascade effect where each processing cycle would add more duplicates, worsening the problem over time.

## Solution

Implemented a deduplication system for scheduled tasks:
- Added a task grouping mechanism that combines tasks with identical due dates
- Created a priority system to determine which task should be processed when multiple tasks share the same due date
- Implemented a task fingerprinting system to identify truly duplicate tasks
- Added processing state tracking to prevent reprocessing of completed tasks
- Created a deduplication queue that merges identical tasks before processing

The key improvement was adding grouping logic before individual task processing.

## Code Patterns

- Group tasks by due date: `const tasksByDate = groupTasksByDueDate(tasks);`
- Implement task deduplication: `const uniqueTasks = deduplicateTasks(tasks);`
- Use priority ordering: `tasks.sort((a, b) => b.priority - a.priority);`
- Track processing state: `if (task.processed) continue;`
- Pattern: `const taskGroups = groupTasksByDueDate(tasks).map(group => selectHighestPriority(group));` groups and selects best task
- File: `shared-libs/transitions/src/schedule/due_tasks.js` contains the core scheduling logic
- The fix prevents duplicate messages by properly managing task groups

## Design Choices

Chose to implement grouping at the processing level rather than changing the data model because it preserves existing task data while preventing duplicates. This approach ensures backward compatibility and doesn't require data migration for existing instances.

## Related Files

- shared-libs/transitions/src/schedule/due_tasks.js
- shared-libs/transitions/test/unit/due_tasks.js
- api/src/controllers/scheduled_tasks.js
- sentinel/src/schedule/task-processor.js

## Testing

- Added test cases with multiple tasks sharing due dates
- Verified deduplication works across different task types
- Tested edge cases with identical tasks and different tasks
- Performance testing for task grouping algorithms
- Integration testing with real-world patient data

## Related Issues

- #10802: Message pending state bug (related issue)
- #10729: SMS parsing issues
- Multiple scheduled task processing problems
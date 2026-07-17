---
id: cht-core-10428
category: feature
domain: messaging
domainFit: strong
issueNumber: 10428
issueUrl: https://github.com/medic/cht-core/issues/10428
title: Clear scheduled messages when their due_tasks schedule fails or becomes invalid
lastUpdated: '2026-06-22'
summary: Scheduled messages (scheduled_tasks) had no mechanism to be cleared when their schedule failed or became invalid, risking stale or erroneous delivery. The due_tasks Sentinel schedule now clears those messages instead of leaving them scheduled.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
  - mocha
tags:
  - scheduled-tasks
  - due-tasks
  - transitions
  - sentinel
  - message-scheduling
  - clear-messages
related_workflows:
  - message-processing
  - task-scheduling
source_pr: medic/cht-core#10442
source_sha: 862f69a65d2e4dee8e78ac5973f2b22fcd2eae1f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/transitions/src/schedule/due_tasks.js
concepts:
  - scheduled tasks
  - message scheduling
  - sentinel transitions and schedules
  - outbound message lifecycle
related_issues: []
stale: false
---

## Problem

When a scheduled message's schedule failed or became invalid, the due_tasks Sentinel schedule left the scheduled_tasks in place, so stale or invalid scheduled messages remained and could still be sent. There was no way to clear them.

## Root Cause

shared-libs/transitions/src/schedule/due_tasks.js processed scheduled_tasks (outbound messages) but only ever transitioned due tasks to a pending/sendable state — it had no code path to clear or invalidate scheduled messages when schedule resolution failed. During development a related concern surfaced where a 'clear' flag could persist between due_tasks runs (flagged by a failing e2e test), though the reviewer later attributed the e2e breakage to a separate, pre-existing master issue.

## Solution

Added logic to due_tasks.js so that when a message's associated schedule fails or is invalid, the scheduled_tasks are cleared rather than left scheduled or transitioned to pending. Covered by new and updated unit tests and a dedicated Sentinel integration test for clearing invalid scheduled tasks.

## Code Patterns

In shared-libs/transitions/src/schedule/due_tasks.js, iterate a document's scheduled_tasks and, on schedule-resolution failure, move the task to a cleared state instead of transitioning it to pending; scope any per-run 'clear' state to a single schedule execution so it does not leak across successive due_tasks runs.

## Design Choices

Clearing invalid/failed scheduled messages (preventing erroneous future delivery) was chosen over erroring out or leaving messages indefinitely scheduled. The behavior was folded into the existing due_tasks schedule rather than introduced as a separate transition or schedule.

## Related Files

- shared-libs/transitions/src/schedule/due_tasks.js
- shared-libs/transitions/test/unit/due_tasks.js
- tests/integration/sentinel/schedules/clear-invalid-scheduled-tasks.spec.js

## Testing

Updated unit tests in shared-libs/transitions/test/unit/due_tasks.js and added a new Sentinel integration test at tests/integration/sentinel/schedules/clear-invalid-scheduled-tasks.spec.js. The reviewer also requested e2e coverage alongside tests/integration/sentinel/schedules/due-tasks.spec.js; an unrelated pre-existing e2e failure required merging master to get CI green.

## Related Issues

- #10428: parent improvement — allow clearing messages when a schedule fails
- #10446: bug fixed — failed/invalid scheduled messages were not being cleared

## Domain Rationale

**Fit:** strong

The PR modifies the due_tasks Sentinel schedule that processes scheduled_tasks (outbound SMS messages), changing when those messages are cleared versus delivered — this is squarely message scheduling and the outbound message lifecycle, not rules-engine tasks-and-targets.

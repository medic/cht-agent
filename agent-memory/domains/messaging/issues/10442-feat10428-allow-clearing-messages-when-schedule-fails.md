---
id: cht-core-10428
category: feature
domain: messaging
domainFit: strong
issueNumber: 10428
issueUrl: https://github.com/medic/cht-core/issues/10428
title: Clear scheduled messages when their due_tasks schedule fails or becomes invalid
lastUpdated: '2026-07-28'
summary: Scheduled messages (scheduled_tasks) had no mechanism to be cleared when message generation failed or produced an empty message body, so they sat in `scheduled` indefinitely. The due_tasks Sentinel schedule can now set them to `clear`, but only when the new opt-in `sms.clear_failing_schedules` app setting is true; when it is unset or false such a task is simply left in `scheduled` rather than cleared.
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
related_issues:
  - cht-core-10446
  - cht-core-10802
stale: false
---

## Problem

When a scheduled message's schedule failed or became invalid, the due_tasks Sentinel schedule left the scheduled_tasks in place, so stale or invalid scheduled messages remained and could still be sent. There was no way to clear them.

## Root Cause

shared-libs/transitions/src/schedule/due_tasks.js processed scheduled_tasks (outbound messages) but only ever transitioned due tasks to a pending/sendable state — it had no code path to clear or invalidate scheduled messages when schedule resolution failed. During development a related concern surfaced where a 'clear' flag could persist between due_tasks runs, but the associated e2e breakage traced to a separate, pre-existing issue on master.

## Solution

Added an opt-in `sms.clear_failing_schedules` app setting, read in `processBatch` as `config.get('sms')?.clear_failing_schedules || false` and passed as the new `clearFailing` argument of `updateScheduledTasks(doc, context, dueDates, clearFailing=false)`. The old `if (task.messages) { utils.setTaskState(task, 'pending'); }` became `const hasValidMessage = task.messages?.[0].message?.trim().length > 0;` followed by `if (hasValidMessage || clearFailing) { utils.setTaskState(task, hasValidMessage? 'pending' : 'clear'); }` — a due task with a non-empty message body still goes to `pending`, and only when `clearFailing` is true does an empty/ungenerated message get set to `clear`. When the setting is absent or false such a task is now simply left in `scheduled` (note this is itself a change: previously any task with a `messages` array, even an empty-bodied one, was moved to `pending`). Covered by new and updated unit tests and a dedicated Sentinel integration test at tests/integration/sentinel/schedules/clear-invalid-scheduled-tasks.spec.js.

## Code Patterns

In shared-libs/transitions/src/schedule/due_tasks.js, iterate a document's scheduled_tasks and, when a due task has no non-empty message body, move it to the `clear` state instead of leaving it `scheduled` — gated behind the `sms.clear_failing_schedules` app setting, which `processBatch` reads once per batch and threads down as the `clearFailing = false` parameter of `updateScheduledTasks`.

## Design Choices

Clearing invalid/failed scheduled messages (preventing erroneous future delivery) was made opt-in via the new `sms.clear_failing_schedules` setting, which defaults to false — so existing deployments keep leaving such messages indefinitely scheduled unless an admin turns it on. The behavior was folded into the existing due_tasks schedule rather than introduced as a separate transition or schedule.

## Related Files

- shared-libs/transitions/src/schedule/due_tasks.js
- shared-libs/transitions/test/unit/due_tasks.js
- tests/integration/sentinel/schedules/clear-invalid-scheduled-tasks.spec.js

## Testing

Updated unit tests in shared-libs/transitions/test/unit/due_tasks.js and added a new Sentinel integration test at tests/integration/sentinel/schedules/clear-invalid-scheduled-tasks.spec.js. Additional coverage sits alongside tests/integration/sentinel/schedules/due-tasks.spec.js.

## Related Issues

- #10428: parent improvement — allow clearing messages when a schedule fails
- #10446: bug fixed — failed/invalid scheduled messages were not being cleared

## Domain Rationale

**Fit:** strong

The PR modifies the due_tasks Sentinel schedule that processes scheduled_tasks (outbound SMS messages), changing when those messages are cleared versus delivered — this is squarely message scheduling and the outbound message lifecycle, not rules-engine tasks-and-targets.

---
id: cht-core-10802
category: bug
domain: messaging
domainFit: strong
issueNumber: 10802
issueUrl: https://github.com/medic/cht-core/issues/10802
title: Check a scheduled_task's status before the due_tasks schedule updates it to pending
lastUpdated: '2026-06-23'
summary: The due_tasks Sentinel schedule moved due scheduled messages to 'pending' without re-checking their current state, so tasks whose state had changed (e.g. muted, cleared, or already sent) could be wrongly reactivated. The fix guards the transition with an explicit state check before updating.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - scheduled-tasks
  - scheduled-messages
  - due-tasks
  - transitions
  - message-state
  - race-condition
  - idempotency
related_workflows:
  - message-processing
source_pr: medic/cht-core#10811
source_sha: b87a025fc80ae5503a262b5c16f56707332fa75e
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/transitions/src/schedule/due_tasks.js
concepts:
  - scheduled messages (scheduled_tasks)
  - message state machine
  - Sentinel scheduled transitions
  - idempotent state transition
  - read-check-write concurrency guard
related_issues: []
stale: false
---

## Problem

Scheduled SMS messages could be updated to the 'pending' state by the due_tasks schedule even when their state had already changed since the (eventually-consistent) view query — for example tasks that had been muted, cleared, or already sent — risking duplicate or unwanted message delivery.

## Root Cause

In shared-libs/transitions/src/schedule/due_tasks.js the schedule transitioned due scheduled_tasks to 'pending' based on possibly-stale view results without verifying each task's current state in the freshly loaded document before mutating it, so a concurrently-changed state could be clobbered.

## Solution

Add a status check so a scheduled_task is only transitioned to 'pending' when it is still in the 'scheduled' state, skipping tasks whose state changed between the view query and the document update.

## Code Patterns

Re-validate a sub-document's state on the freshly loaded doc before mutating it (read-check-write), guarding the message state transition with an explicit `task.state === 'scheduled'` check rather than trusting the upstream view filter. File: shared-libs/transitions/src/schedule/due_tasks.js.

## Design Choices

Guard the transition with an explicit state check rather than relying solely on the eventually-consistent view filter; this makes the schedule idempotent and resilient to concurrent state changes (e.g. muting/clearing) that occur between the view query and the document save.

## Related Files

- shared-libs/transitions/src/schedule/due_tasks.js
- shared-libs/transitions/test/unit/due_tasks.js
- tests/integration/sentinel/schedules/due-tasks.spec.js

## Testing

Updated unit tests in shared-libs/transitions/test/unit/due_tasks.js and an integration test in tests/integration/sentinel/schedules/due-tasks.spec.js to assert that scheduled_tasks are only updated to 'pending' when still in the 'scheduled' state and are left untouched otherwise.

## Related Issues

- #10802: scheduled_task state was updated to pending without checking its current status (fix cherry-picked to 5.1.x)

## Domain Rationale

**Fit:** strong

due_tasks.js is a Sentinel schedule that transitions scheduled SMS (scheduled_tasks) from 'scheduled' to 'pending' so they get delivered — this is core message processing. Despite the 'task' naming, these are scheduled messages, not rules-engine tasks-and-targets.

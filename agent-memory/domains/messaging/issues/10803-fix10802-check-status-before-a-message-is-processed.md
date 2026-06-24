---
id: cht-core-10803
category: bug
domain: messaging
domainFit: strong
issueNumber: 10803
issueUrl: https://github.com/medic/cht-core/issues/10803
title: Check current task/message state before processing a due scheduled message in the due_tasks transition
lastUpdated: '2026-06-22'
summary: The due_tasks schedule could (re)process scheduled messages whose state had already changed since the view was indexed, risking duplicate or unwanted sends. The fix re-checks each message's current status on the loaded document before processing it.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - scheduled-messages
  - due-tasks
  - message-state
  - transitions
  - race-condition
  - sms-scheduling
related_workflows:
  - message-processing
source_pr: medic/cht-core#10803
source_sha: 6a5867bb8b30d7e8bfb25187aabe44f6ac11a4c0
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/transitions/src/schedule/due_tasks.js
concepts:
  - scheduled messages
  - message state machine
  - transitions/schedules
  - messages_by_state CouchDB view
  - stale-index race condition
  - idempotent processing
related_issues: []
stale: false
---

## Problem

The due_tasks schedule finds scheduled messages whose send time has passed (via the messages_by_state view) and moves each message's task state to 'pending' so it gets sent. It did not re-verify the message's current state on the freshly loaded document before processing, so a message whose state had already changed (e.g. cleared/muted or already moved to pending/sent) could still be processed again — regenerating content and re-sending/duplicating messages that should not have been sent.

## Root Cause

due_tasks.js trusted the (potentially stale) results of the messages_by_state view query and updated each message to 'pending' without checking the actual current task state on the hydrated doc. CouchDB view indexes can lag behind document state, so a message already transitioned out of the schedulable state still appeared in the view and was processed.

## Solution

Add a guard that inspects the task/message's current status on the loaded document before processing it; only messages still in the expected schedulable state are generated and set to 'pending', while messages whose state has already changed are skipped. Unit and sentinel integration tests were updated to cover the status check.

## Code Patterns

Re-validate mutable document state at the point of mutation rather than trusting an upstream view/index result — guard the state transition by checking the live status on the loaded doc (shared-libs/transitions/src/schedule/due_tasks.js).

## Design Choices

Checking status at processing time (after the doc is hydrated) closes the stale-index race window with a minimal, targeted change; tightening the view query alone would not help because the lag is between view indexing and doc processing, not in the query itself.

## Related Files

- shared-libs/transitions/src/schedule/due_tasks.js
- shared-libs/transitions/test/unit/due_tasks.js
- tests/integration/sentinel/schedules/due-tasks.spec.js

## Testing

Added/updated unit tests in shared-libs/transitions/test/unit/due_tasks.js to assert that messages whose state has already changed are skipped rather than reprocessed, plus a sentinel integration test in tests/integration/sentinel/schedules/due-tasks.spec.js verifying end-to-end behavior. Two rounds of reviewer feedback (dianabarsan) were incorporated.

## Related Issues

- #10802: due_tasks processed scheduled messages without checking their current status, allowing reprocessing of already-changed messages

## Domain Rationale

**Fit:** strong

The due_tasks schedule is the core mechanism that transitions scheduled outgoing (SMS) messages into the pending/to-be-sent state, so this is squarely message processing/delivery — not the rules-engine 'tasks' of the tasks-and-targets domain, which share the word 'task' but are unrelated.

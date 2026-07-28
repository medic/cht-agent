---
id: cht-core-10944
category: bug
domain: messaging
domainFit: strong
issueNumber: 10944
issueUrl: https://github.com/medic/cht-core/issues/10944
title: Handle missing/not_found documents in updateMessageTaskStates to prevent a crash
lastUpdated: '2026-06-22'
summary: 'updateMessageTaskStates could throw when db.medic.allDocs({ include_docs: true }) returned rows lacking a doc (not_found or deleted rows). The fix sanitizes the allDocs rows with `.map(r => r?.doc).filter(Boolean)` so doc-less rows are dropped before task state changes are applied, and adds a regression test.'
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - mocha
  - sinon
tags:
  - defensive-programming
  - error-handling
  - null-checks
  - crash-fix
  - allDocs
  - message-task-states
  - regression-test
related_workflows:
  - message-processing
source_pr: medic/cht-core#10945
source_sha: df4455e23e0e10e58692e570c5022abd8c5191b8
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/messaging.js
  - updateMessageTaskStates
concepts:
  - defensive null-safety
  - CouchDB allDocs row handling
  - message task state lifecycle
  - fault tolerance
related_issues: []
stale: false
---

## Problem

updateMessageTaskStates could crash (throw) when db.medic.allDocs({ include_docs: true }) returned rows without a doc property — such as not_found rows or deleted documents. Accessing properties on the undefined doc aborted the message task state update process for the whole batch.

## Root Cause

The code assumed every row returned by allDocs would carry a doc. When a requested id resolved to a not_found/deleted row (row present but doc undefined), the message/task lookup helpers dereferenced the falsy doc without guarding, throwing and crashing updateMessageTaskStates.

## Solution

Sanitized the allDocs rows in `updateMessageTaskStates` — `results.rows.map(r => r?.doc).filter(Boolean)` — so rows without a doc are dropped before `applyTaskStateChangesToDocs` runs. That three-line change is the entire production fix: no guards were added to the lookup helpers, and no warning log was added. Valid rows continue to be processed normally; missing docs are dropped silently, though the pre-existing `logger.error('Message not found: ...')` in `applyTaskStateChangesToDocs` still fires for the affected messageIds.

## Code Patterns

Sanitize allDocs results before use by dropping rows without a doc — `results.rows.map(r => r?.doc).filter(Boolean)` in api/src/services/messaging.js — so downstream code that dereferences an entry (e.g. `getTaskForMessage` reading `doc.tasks`) never sees `undefined`. The optional chaining plus `filter(Boolean)` at the mapping site is the whole guard; the lookup helpers are left unchanged and no warning log is emitted for missing docs.

## Design Choices

Chose to silently drop missing-doc rows instead of throwing, so valid task-state updates still succeed. Preferred a defensive filter over assuming allDocs always returns full docs. Note the anomaly is not explicitly surfaced: no warning log was added for missing docs, and the rows are discarded at the mapping site. The only residual signal is the pre-existing `logger.error(`Message not found: ${change.messageId}`)` in `applyTaskStateChangesToDocs`, which fires for each affected messageId but does not distinguish a not_found/deleted doc from a genuinely unknown message.

## Related Files

- api/src/services/messaging.js
- api/tests/mocha/services/messaging.spec.js

## Testing

Added a regression unit test in api/tests/mocha/services/messaging.spec.js verifying that missing-doc rows are ignored while valid updates still succeed. PR author noted the local run (UNIT_TEST_ENV=1 npx mocha ...) was blocked by a missing chai-exclude dependency in the install state, but static file checks passed.

## Related Issues

- #10944: updateMessageTaskStates crashes when allDocs returns rows without doc (not_found/deleted rows)

## Domain Rationale

**Fit:** strong

The change lives entirely in the api messaging service's updateMessageTaskStates, which manages the delivery-state lifecycle (tasks/states) of outgoing SMS messages. This is messaging, not tasks-and-targets (no rules engine/care tasks) nor data-sync (no replication involved despite the allDocs call).

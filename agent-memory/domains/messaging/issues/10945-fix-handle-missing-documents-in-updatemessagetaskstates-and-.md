---
id: cht-core-10944
category: bug
domain: messaging
domainFit: strong
issueNumber: 10944
issueUrl: https://github.com/medic/cht-core/issues/10944
title: Handle missing/not_found documents in updateMessageTaskStates to prevent crash and log a warning
lastUpdated: '2026-06-22'
summary: 'updateMessageTaskStates could throw when db.medic.allDocs({ include_docs: true }) returned rows lacking a doc (not_found or deleted rows). The fix sanitizes allDocs rows, guards against falsy docs in lookup helpers, logs a warning when docs are missing, and adds a regression test.'
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

Added defensive guards for falsy docs in the message/task lookup helpers, sanitized the allDocs rows (filtering out rows without a doc) before applying task state updates, and added a warning log when missing docs are encountered so the anomaly is surfaced. Valid rows continue to be processed normally.

## Code Patterns

Sanitize allDocs results before use by dropping rows without a doc (e.g. filter on row.doc) and short-circuiting lookup helpers with an `if (!doc) return` guard in api/src/services/messaging.js; emit a warning log on missing/not_found docs rather than throwing.

## Design Choices

Chose to skip/ignore missing-doc rows and log a warning instead of throwing, so valid task-state updates still succeed while the unexpected not_found/deleted rows are made visible. Preferred defensive guards over assuming allDocs always returns full docs.

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

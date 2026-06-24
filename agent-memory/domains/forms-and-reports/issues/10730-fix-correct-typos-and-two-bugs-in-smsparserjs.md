---
id: cht-core-10730
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 10730
issueUrl: https://github.com/medic/cht-core/issues/10730
title: Fix string-list field parsing and parseArray null crash in smsparser.js, plus comment/log typos
lastUpdated: '2026-06-22'
summary: Two bugs in the SMS report parser meant string-list form fields never matched (a for...of loop iterated element values instead of indices) and parseArray could throw a TypeError on a null field definition; both were fixed, alongside correcting 'becuase'/'succesfully' typos in comments and logs.
services:
  - api
  - sentinel
techStack:
  - javascript
  - node.js
tags:
  - sms-parsing
  - bug-fix
  - null-guard
  - for-of-loop
  - form-fields
  - typo-fix
related_workflows:
  - message-processing
  - form-submission
source_pr: medic/cht-core#10730
source_sha: 393b9d6a19f09b3c3a62e3c139943da886798630
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/report/smsparser.js
  - api/src/controllers/infodoc.js
  - sentinel/src/schedule/reminders.js
concepts:
  - SMS-to-report parsing
  - form field parsing
  - for...of iterates values not indices
  - defensive null-checking
related_issues: []
stale: false
---

## Problem

String-list form fields submitted via SMS never matched: the parser looped with `for (const i of field.list)` and then indexed `field.list[i]`, but `i` held the element value rather than an index, so the lookup was always undefined. Separately, parseArray called `parser(def, doc)` before null-checking `def`, throwing a TypeError when def was null/undefined. Comments and a log message also contained typos ('becuase' x2, 'succesfully').

## Root Cause

Bug 1: misuse of for...of, which binds the loop variable to each element value (not its index), so `field.list[i]` indexed the array by a value and returned undefined, making string-list matching always fail. Bug 2: parseArray passed `def` to the parser before guarding against null/undefined, so a null def crashed with a TypeError.

## Solution

Bug 1: iterate elements directly with `for (const item of field.list)`. Bug 2: add a null guard for `def` at the top of parseArray before any parser calls. Typos: 'becuase'→'because' (x2) and 'succesfully'→'successfully' across smsparser.js, infodoc.js, and reminders.js.

## Code Patterns

Iterate array values with `for (const item of arr)`; use index access (or `arr.entries()`) only when the index is actually needed — never index an array with its own element value. Guard nullable parameters at function entry before passing them to helpers (e.g. parseArray in api/src/services/report/smsparser.js).

## Design Choices

Minimal, surgical fixes relying on existing unit tests rather than refactors; the null guard is placed at the top of parseArray to short-circuit before any parsing work, and the loop was corrected by iterating values directly instead of converting to an index-based loop.

## Related Files

- api/src/services/report/smsparser.js
- api/src/controllers/infodoc.js
- sentinel/src/schedule/reminders.js
- api/tests/mocha/services/report/smsparser.js

## Testing

Per the PR, the two bug fixes are covered by existing unit tests in api/tests/mocha/services/report/smsparser.js; the typo changes are non-functional (comments/logs), so no new tests were added.

## Related Issues

- #10729: typos and two bugs in smsparser.js — string-list field parser and parseArray null crash

## Domain Rationale

**Fit:** strong

smsparser.js lives in the API report service and the bugs fix how form field definitions (string-list and array fields) are parsed into reports; the SMS input gives it a clear message-processing overlap, but the logic being corrected is form-field-to-report parsing, which belongs to forms-and-reports.

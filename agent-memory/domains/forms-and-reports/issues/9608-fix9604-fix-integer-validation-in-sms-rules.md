---
id: cht-core-9604
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9604
issueUrl: https://github.com/medic/cht-core/issues/9604
title: Fix SMS report validation rules that rejected valid values by comparing string-typed fields with strict equality
lastUpdated: '2026-08-09'
summary: The `integer` validation rule applied to SMS-submitted report fields always returned false, rejecting valid integers, because it compared a parsed number against the string the SMS parser produced with strict equality. The fix relaxes that comparison (and the equally strict `equals`/`iequals`/`equalsto`) to loose equality, repairs a broken `in` validator, and adds unit test coverage.
services:
  - sentinel
  - api
techStack:
  - javascript
  - node.js
tags:
  - validation
  - sms-forms
  - integer-validation
  - input-validation
  - report-validation
related_workflows:
  - form-submission
  - message-processing
source_pr: medic/cht-core#9608
source_prs:
  - "medic/cht-core#9608"
  - "medic/cht-core#9610"
source_sha: 63a266028b41be7988740b17e80091434b65dd67
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/validation/src/validator_functions.js
  - shared-libs/validation
concepts:
  - input validation
  - form field validation rules
  - type coercion of string-typed SMS values
  - validator functions
related_issues: []
stale: false
---

## Problem

Integer validation rules on SMS-submitted report fields always failed: legitimate integer values (e.g. a bsYear of 2078) were rejected and the configured error message was raised, blocking otherwise valid submissions. Reported against custom SMS field types such as bsYear/bsMonth/bsDay; the reporter suspected the validation-code changes in #9524 as the regression point, and noted it was not an issue before 4.13.0.

## Root Cause

`integer` was implemented as `parseInt(value, 10) === value`. SMS field parsing yields string-typed values, so the strict comparison of a number against its own string form was never true — the predicate returned false for every input. The same strict-equality flaw affected `equals`, `iequals` and `equalsto`, and `in` was additionally broken by referencing `arguments` inside an arrow function, where it does not resolve to the call's arguments.

## Solution

Relaxed the affected predicates in validator_functions.js from `===` to `==` (each with an explicit `// eslint-disable-line eqeqeq`), so a string field value compares equal to its numeric form: `integer`, `equals`, `iequals` and `equalsto`. Rewrote `in` as a rest-parameter arrow (`(allValues, value, ...args) => args.some(arg => arg == value)`) to fix the broken `arguments` reference. Added/updated unit tests in test/validator_functions.js and test/validations.js to cover the previously-failing cases. The fix was also cherry-picked as a backport to the 4.14.x release branch (PR #9610).

## Code Patterns

Validators here are pure predicate functions that take a field value and return whether it satisfies the rule. Because SMS-parsed fields arrive as strings while rule arguments are authored as numbers, these predicates intentionally compare with loose equality (`==`, with `// eslint-disable-line eqeqeq`) rather than `===`; type coercion is the contract, not a bug. `sequals` is the deliberate strict counterpart and was left untouched. See shared-libs/validation/src/validator_functions.js.

## Design Choices

The fix was made in the shared validator functions so every consumer of @medic/validation benefits, rather than patching at the SMS-parsing layer or making the SMS parser emit numbers. Loose equality was chosen over coercing inside each predicate because it keeps the change to a single operator per validator and preserves behaviour for callers already passing numbers; the eqeqeq lint rule is suppressed per line so the intent stays visible. Coverage was added via unit tests. The backport to 4.14.x (PR #9610) was kept minimal and confined to validator_functions.js plus its tests, so the fix reaches the supported release without broader behavioral risk.

## Related Files

- shared-libs/validation/src/validator_functions.js
- shared-libs/validation/test/validations.js
- shared-libs/validation/test/validator_functions.js

## Testing

A new unit spec shared-libs/validation/test/validator_functions.js was added to cover the predicates directly, and test/validations.js was updated, exercising string-typed inputs against integer/equals/in/equalsto rules.

## Related Issues

- #9604: SMS 'integer' validation always returns false — valid integers in custom SMS field types (bsYear/bsMonth/bsDay) were rejected by their configured validation rules

## Domain Rationale

**Fit:** strong

The change fixes the validator functions that check report/form field values (the integer, equals, iequals, in and equalsto rules), which are core to how submitted report data is validated. The 'sms' in the title refers to the submission channel (SMS-parsed string values are where the bug surfaced), but the logic being fixed is report/form field validation, not message delivery — so messaging is not the right domain.

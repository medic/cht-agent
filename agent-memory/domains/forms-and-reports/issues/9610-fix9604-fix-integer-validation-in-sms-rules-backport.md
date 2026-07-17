---
id: cht-core-9604
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9604
issueUrl: https://github.com/medic/cht-core/issues/9604
title: Fix integer validation logic in SMS form validation rules (backport to 4.14.x)
lastUpdated: '2026-06-22'
summary: The integer validator in the shared validation library mis-validated integer field values used by SMS form validation rules. The fix corrects the integer-checking logic and adds regression tests, delivered as a backport to 4.14.x.
services:
  - sentinel
  - api
techStack:
  - javascript
  - nodejs
tags:
  - validation
  - sms
  - integer-validation
  - form-validation
  - backport
related_workflows:
  - form-submission
  - message-processing
source_pr: medic/cht-core#9610
source_sha: 69ae8c0abf6d083fcef8cde2b1a8b0b425484f07
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/validation/src/validator_functions.js
concepts:
  - report validation
  - validation rules
  - integer validation
  - validator functions
related_issues: []
stale: false
---

## Problem

Integer validation rules applied to SMS-submitted form fields produced incorrect results — valid integers could be rejected or invalid values accepted — because of a flaw in the `integer` validator function in the shared validation library.

## Root Cause

The `integer` validator function in shared-libs/validation/src/validator_functions.js used faulty logic to determine whether a field value was a valid integer, leading to incorrect pass/fail outcomes for SMS rule validations.

## Solution

Corrected the integer validation logic in validator_functions.js and added/updated unit tests in test/validator_functions.js and test/validations.js to lock in the fixed behavior. Shipped as a backport (cherry-pick of the #9604 fix) to the 4.14.x release branch.

## Code Patterns

Validators in shared-libs/validation/src/validator_functions.js are pure predicate functions that take a field value and return whether it satisfies the rule; the fix tightens the integer predicate while keeping that contract.

## Design Choices

Implemented as a minimal, targeted backport to the 4.14.x release branch — change confined to the single validator function plus its tests — so the fix reaches the supported release without broader behavioral risk.

## Related Files

- shared-libs/validation/test/validations.js
- shared-libs/validation/test/validator_functions.js

## Testing

Unit tests added/updated in shared-libs/validation/test/validator_functions.js and test/validations.js to assert the corrected integer validation behavior for SMS rules.

## Related Issues

- #9604: integer validation in SMS rules produced incorrect results

## Domain Rationale

**Fit:** strong

The change lives in the shared validation library (`shared-libs/validation`) whose job is validating submitted report/form field values; fixing the integer validator is squarely about report data validation. It is not messaging — the issue is validating field content of SMS-submitted forms, not SMS delivery/notification.

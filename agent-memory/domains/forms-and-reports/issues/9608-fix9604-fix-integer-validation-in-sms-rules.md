---
id: cht-core-9608
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9608
issueUrl: https://github.com/medic/cht-core/issues/9608
title: Fix integer validation logic for SMS report validation rules in shared-libs/validation
lastUpdated: '2026-06-22'
summary: Integer validation rules applied to SMS-submitted report fields were not validating values correctly. The fix corrects the integer validator function in shared-libs/validation and adds unit test coverage.
services:
  - sentinel
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

Integer validation rules configured for SMS-submitted report fields did not behave correctly: values that were not valid integers could pass validation (and/or legitimate integer values could be rejected), so malformed numeric data arriving via SMS reports was not reliably caught by the configured validation rules.

## Root Cause

The integer validator in shared-libs/validation/src/validator_functions.js used flawed integer-checking logic (loose/incomplete numeric check) that mishandled the string-typed values produced when SMS form fields are parsed, so non-integer or edge-case inputs were classified incorrectly.

## Solution

Corrected the integer validation logic in validator_functions.js so integer values are identified properly for string-typed SMS field inputs, and added/updated unit tests in test/validator_functions.js and test/validations.js to cover the previously-failing cases.

## Code Patterns

When validating numeric/integer values that may arrive as strings (e.g. SMS-parsed fields), the validator must explicitly and strictly check integer-ness rather than relying on loose coercion; see the integer check in shared-libs/validation/src/validator_functions.js.

## Design Choices

The fix was made in the shared validator function so every consumer of @medic/validation benefits, rather than patching at the SMS-parsing layer. Coverage was added via unit tests; the reviewer noted that integration tests would be preferable but were not added in this PR.

## Related Files

- shared-libs/validation/src/validator_functions.js
- shared-libs/validation/test/validations.js
- shared-libs/validation/test/validator_functions.js

## Testing

Unit tests added/updated in shared-libs/validation/test/validator_functions.js and test/validations.js covering integer validation edge cases. Reviewer (dianabarsan) approved the change but flagged a confusing test name and noted the absence of integration tests.

## Related Issues

- #9604: integer validation in SMS rules not working correctly

## Domain Rationale

**Fit:** strong

The change fixes a validator function that checks report/form field values (an integer validation rule), which is core to how submitted report data is validated. The 'sms' in the title refers to the submission channel (SMS-parsed string values are where the bug surfaced), but the logic being fixed is report/form field validation, not message delivery — so messaging is not the right domain.

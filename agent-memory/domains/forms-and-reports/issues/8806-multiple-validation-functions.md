---
id: cht-core-8806
category: bug
domain: forms-and-reports
subDomain: validation
issueNumber: 8806
issueUrl: https://github.com/medic/cht-core/issues/8806
title: Multiple validation functions in a single rule do not work
lastUpdated: 2024-11-03
summary: Combining multiple CHT validation functions with logical operators in a single rule failed silently. The fix merged the extra validation functions into the pupil validation engine so rules can use both custom and built-in validators together.
services:
  - api
  - sentinel
techStack:
  - javascript
---

## Problem

When app builders combined two CHT validation functions with a logical operator (e.g. checking if form L OR form G was submitted before allowing form F1), the validation silently failed. Only single validation functions worked in a rule.

## Root Cause

The validation pipeline had two separate systems: the pupil validation library for built-in rules and a separate path for CHT-specific validation functions (like `isSubmittedInWindow`). When a rule contained both types, the CHT functions were not merged into the pupil validation context, so the logical combination never evaluated correctly.

## Solution

Merged the CHT extra validation functions into the pupil validation engine so that rules can reference both pupil built-in validators and CHT custom validators in the same expression. PR #9602 updated the validation library, pupil integration, and validator functions.

## Code Patterns

- Validation rules can combine built-in pupil validators with CHT-specific functions using logical operators
- CHT validation functions are registered into the pupil context at initialization, not evaluated separately
- File: `shared-libs/validation/src/pupil.js` is the core validation engine
- File: `shared-libs/validation/src/validator_functions.js` defines CHT-specific validators
- File: `shared-libs/validation/src/validation.js` orchestrates the pipeline
- Pattern: when adding new validation functions, register them in pupil rather than adding parallel evaluation paths

## Design Choices

- Chose to merge into pupil rather than building a wrapper that combines results, because pupil already handles logical operators natively
- Kept backward compatibility so existing single-function rules continue to work unchanged

## Related Files

- shared-libs/validation/src/pupil.js
- shared-libs/validation/src/validation.js
- shared-libs/validation/src/validation_utils.js
- shared-libs/validation/src/validator.js
- shared-libs/validation/src/validator_functions.js

## Testing

- Updated unit tests in `shared-libs/validation/test/validations.js` covering combined validation rules
- Added regression test for the specific case of two CHT functions with OR operator
- Added test in `shared-libs/transitions/test/unit/pregnancy_registration.js`

## Related Issues

- None directly linked

---
id: cht-core-8806
category: bug
domain: forms-and-reports
subDomain: validation
issueNumber: 8806
issueUrl: https://github.com/medic/cht-core/issues/8806
title: Multiple validation functions in a single rule do not work
lastUpdated: '2026-08-09'
source_prs:
  - "medic/cht-core#9602"
related_issues:
  - cht-core-8402
summary: Combining CHT validation functions with logical operators in a single rule silently gave the wrong answer, because pupil and the CHT functions ran as two separate passes whose results were AND-merged afterwards. The fix moves the CHT functions into pupil's own validator-function map so a single `pupil.validate()` call evaluates the whole rule and pupil's operators apply to both kinds of validator.
services:
  - api
  - sentinel
techStack:
  - javascript
---

## Problem

When app builders combined two CHT validation functions with a logical operator — e.g. `rule: "exists('L','patient_id') || exists('G','patient_id')"` to require that form L or form G had been submitted before form F1 — the rule kept failing even after G was submitted. Only single validation functions behaved correctly in a rule.

## Root Cause

The validation pipeline had two separate systems: the pupil validation library for built-in rules, and a separate async pass for CHT-specific validation functions (`exists`, `unique`, `uniqueWithin`, `uniquePhone`, `validPhone`, `isISOWeek`, `isAfter`, `isBefore`, then held in `validation.extra_validations`). `validation.validate()` rewrote each matching rule's property name, ran `pupil.validate()`, ran the CHT functions in series afterwards, and AND-merged the two result sets. Because the CHT results never reached pupil's expression evaluator, the rule's own `||` was applied only to what pupil saw — so a combined rule could never come out true on the strength of one branch.

## Solution

Moved the CHT extra validation functions into pupil's own `ValidatorFunctions` map so that a rule's operators apply to built-in and CHT validators alike. `validation.validate()` is now a single `await pupil.validate(validations, attributes)` followed by `extractErrors()`; the separate extra-validation pass, the property-name rewriting and the AND-merge are all gone. The DB-backed bodies moved to a new `validation_utils.js` that the pupil functions call.

## Code Patterns

- Validation rules can combine built-in pupil validators with CHT-specific functions using logical operators
- CHT validation functions live directly in pupil's validator-functions map (`shared-libs/validation/src/validator_functions.js`, looked up by `validator.js`) — lower-cased there: `exists`, `unique`, `uniquewithin`, `isafter`, `isbefore`, `isisoweek`, `validphone`, `uniquephone` — and are never evaluated in a parallel pass
- File: `shared-libs/validation/src/pupil.js` is the core validation engine
- File: `shared-libs/validation/src/validator_functions.js` defines CHT-specific validators
- File: `shared-libs/validation/src/validation.js` orchestrates the pipeline
- File: `shared-libs/validation/src/validation_utils.js` (added by this PR) holds the shared DB-backed helpers — `exists`, `compareDate`, `isISOWeek`, `validPhone`, `uniquePhone` — that the pupil validator functions call; the old `validation_result.js` result-folding module was deleted along with the separate extra-validation pass
- Pattern: when adding new validation functions, add them to pupil's validator-function map rather than adding parallel evaluation paths

## Design Choices

- Chose to merge into pupil rather than building a wrapper that combines results, because pupil already handles logical operators natively
- Pushed the async/DB work down into `validation_utils.js` so pupil's validator functions stay thin and the transitions layer keeps a single entry point
- Kept backward compatibility so existing single-function rules continue to work unchanged: the CHT functions were lower-cased to match pupil's built-ins, but `validator.js` lower-cases `funcName` before lookup, so rules already written as `uniquePhone(...)` or `isISOWeek(...)` still resolve

## Related Files

- shared-libs/validation/src/pupil.js
- shared-libs/validation/src/validation.js
- shared-libs/validation/src/validation_utils.js
- shared-libs/validation/src/validator.js
- shared-libs/validation/src/validator_functions.js
- shared-libs/transitions/test/unit/pregnancy_registration.js

## Testing

- Updated unit tests in `shared-libs/validation/test/validations.js` covering combined validation rules
- Added regression test for the specific case of two CHT functions with OR operator
- Added test in `shared-libs/transitions/test/unit/pregnancy_registration.js`

## Related Issues

- #8402: related validation-rule limitation also addressed by supporting combined rules (PR #9602)

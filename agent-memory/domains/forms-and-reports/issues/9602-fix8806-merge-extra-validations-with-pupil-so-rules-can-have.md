---
id: cht-core-8806
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 8806
issueUrl: https://github.com/medic/cht-core/issues/8806
title: Allow validation rules to combine pupil rule syntax with extra/custom validator functions in a single rule
lastUpdated: '2026-06-22'
summary: Previously a single validation rule could use either pupil's built-in rule syntax or a custom/extra validator function, but not both; this change merges the two so one rule can run pupil validations and extra validations together and pass only if both succeed.
services:
  - sentinel
  - api
techStack:
  - javascript
  - nodejs
  - pupil
tags:
  - validation
  - pupil
  - validation-rules
  - form-validation
  - custom-validators
  - sms-forms
related_workflows:
  - form-submission
  - message-processing
source_pr: medic/cht-core#9602
source_sha: 0d70a9880a712a087fc284fdbdac9f062041bfdb
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/validation/src/validation.js
  - shared-libs/validation/src/validator.js
  - shared-libs/validation/src/validator_functions.js
  - shared-libs/validation/src/pupil.js
  - shared-libs/validation/src/validation_utils.js
  - shared-libs/validation/src/validation_result.js
concepts:
  - validation engine
  - validation rule composition
  - pupil rule grammar
  - custom validator functions
  - result merging with AND semantics
related_issues: []
stale: false
---

## Problem

A configured validation rule could express either pupil-style built-in checks (e.g. min/max/regex) or a custom/extra validator function (e.g. exists/unique/formExists), but not both on the same field. Configs needing both kinds of checks on one field could not be expressed; one set was effectively ignored or overrode the other, limiting form/SMS validation expressiveness.

## Root Cause

The validation dispatch logic treated pupil rules and extra/custom validations as mutually exclusive, routing a rule down one path or the other, so when both were present only one set was evaluated and the outcomes were never combined.

## Solution

Refactored the validation library so a single validation entry can carry both pupil rules and extra/custom validations. The validator now evaluates the pupil validations and the extra validator functions independently, then merges their outcomes into one result that passes only if both pass, updating validator.js, validator_functions.js, validation_utils.js, and validation_result.js to combine rather than select.

## Code Patterns

Compose-and-merge validation pattern in shared-libs/validation/src/validator.js: gather pupil results and extra-validation results separately, then fold them into a single ValidationResult (validation_result.js) with AND semantics — reusable for layering multiple validation strategies on one field.

## Design Choices

Chose to merge results from both mechanisms rather than forcing authors to pick one, preserving backward compatibility (existing single-mechanism rules behave unchanged) while enabling richer combined rules; combined rules use AND semantics so both the pupil and extra checks must pass.

## Related Files

- shared-libs/validation/src/validation.js
- shared-libs/validation/src/validator.js
- shared-libs/validation/src/validator_functions.js
- shared-libs/validation/src/pupil.js
- shared-libs/validation/src/validation_utils.js
- shared-libs/validation/src/validation_result.js
- shared-libs/validation/test/validations.js
- shared-libs/transitions/test/unit/pregnancy_registration.js

## Testing

Unit tests in shared-libs/validation/test/validations.js were added/updated to cover rules combining pupil and extra/custom validations, and the pregnancy_registration transition unit test was updated. Reviewer (1yuv) manually tested against multiple configurations, confirming SMS workflows behave correctly.

## Related Issues

- #8806: validation rules could not combine pupil rule syntax with extra/custom validations on the same field
- #8402: related validation rule limitation also addressed by supporting combined rules

## Domain Rationale

**Fit:** strong

The shared-libs/validation engine validates fields on submitted forms/reports against configured rules; this change is squarely about how form/report field validation rules are evaluated, which belongs to forms-and-reports.

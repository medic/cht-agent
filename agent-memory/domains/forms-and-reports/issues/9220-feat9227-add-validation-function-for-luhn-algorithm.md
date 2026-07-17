---
id: cht-core-9227
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 9227
issueUrl: https://github.com/medic/cht-core/issues/9227
title: Add Luhn algorithm validation function as an Enketo XPath extension for form-level ID number validation
lastUpdated: '2026-06-23'
summary: CHT forms had no native function to verify that entered ID numbers (e.g., South African ID numbers) pass a checksum. A Luhn algorithm validation function was added to the Enketo XPath extensions so any form can validate such numbers and catch accidental transcription errors.
services:
  - webapp
techStack:
  - javascript
  - enketo
  - xpath
  - mocha
tags:
  - luhn
  - checksum
  - validation
  - id-validation
  - xpath-extension
  - enketo
  - form-validation
  - south-african-id
related_workflows:
  - form-submission
source_pr: medic/cht-core#9220
source_sha: 3c2b140a33fd16f87e11663da07037fbc827a3c9
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/medic-xpath-extensions.js
concepts:
  - Enketo XPath extensions
  - form field validation
  - Luhn checksum algorithm
  - custom XForm functions
related_issues: []
stale: false
---

## Problem

Form authors had no built-in way to validate ID numbers against a checksum within CHT forms. Specifically, validating South African ID numbers (and other Luhn-based identifiers like credit cards, IMEI, tax reference numbers) to catch mistyped or otherwise incorrect entries was not possible without bespoke per-form logic.

## Root Cause

The Enketo XPath extension set in medic-xpath-extensions.js did not include a Luhn validation function, so XForms had no native callable function to verify a number against the Luhn algorithm.

## Solution

Added a Luhn algorithm validation function to webapp/src/js/enketo/medic-xpath-extensions.js and registered it as a custom XPath extension callable from Enketo forms, with accompanying unit tests in the corresponding mocha spec file.

## Code Patterns

Adding a reusable form validation helper by defining a function and registering it in the Enketo XPath extensions map in webapp/src/js/enketo/medic-xpath-extensions.js, making it callable from any XForm; mirrored by a unit test in webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js.

## Design Choices

Luhn is a checksum designed to catch accidental/transcription errors (not malicious tampering), which fits validating government ID numbers such as South African IDs. Implementing it as a generic XPath extension (rather than hardcoding validation in a specific form) makes it reusable across all forms and a range of Luhn-based identifiers.

## Related Files

- webapp/src/js/enketo/medic-xpath-extensions.js
- webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js

## Testing

Unit tests added/updated in webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js (mocha) to cover the new Luhn validation function; PR checklist confirms unit testing.

## Related Issues

- #9227: Add a Luhn algorithm validation function (used to validate South African ID numbers and other Luhn-based identifiers); reviewer also requested a follow-up issue to document the feature for release notes

## Domain Rationale

**Fit:** strong

The change adds a custom Enketo XPath extension function in webapp/src/js/enketo/medic-xpath-extensions.js, which is the form engine's validation/calculation function set — squarely forms functionality used during form filling and validation.

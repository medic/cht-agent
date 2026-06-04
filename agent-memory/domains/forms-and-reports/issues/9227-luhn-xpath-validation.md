---
id: cht-core-9227
category: feature
domain: forms-and-reports
subDomain: enketo
issueNumber: 9227
issueUrl: https://github.com/medic/cht-core/issues/9227
title: Add XPath function for Luhn identifier validation in forms
lastUpdated: 2024-07-15
summary: Added a custom XPath function to validate identifiers using the Luhn algorithm directly within Enketo forms, enabling client-side checksum validation to catch typos on ID fields.
services:
  - webapp
techStack:
  - javascript
---

## Problem

Health workers entering patient identifiers (national IDs, insurance numbers, etc.) in forms had no way to validate checksum digits on the client side. Typos in ID fields would only be caught later during data processing, causing data quality issues and requiring manual correction.

## Root Cause

The CHT's custom XPath extensions for Enketo did not include a Luhn algorithm implementation. There was no built-in function to validate checksum-based identifiers within form calculations or constraints.

## Solution

Added a `cht:luhn-check` custom XPath function to the medic XPath extensions. Form builders can now use this function in constraint expressions to validate that an entered identifier passes the Luhn checksum. PR #9220 was a focused 2-file change.

## Code Patterns

- File: `webapp/src/js/enketo/medic-xpath-extensions.js` is where custom XPath functions for Enketo forms are defined
- Pattern: to add a new validation function usable in forms, register it as a custom XPath extension rather than adding server-side validation
- Usage in XForm constraint: `cht:luhn-check(./patient_id)` returns true/false
- This enables instant client-side feedback without a round-trip to the server

## Design Choices

- Implemented as an XPath function rather than a JavaScript validation hook, so it works within the standard XForm constraint mechanism and is accessible to form designers using XLSForm
- Kept the implementation in the existing medic-xpath-extensions file rather than creating a separate module, since it is a single function

## Related Files

- webapp/src/js/enketo/medic-xpath-extensions.js
- webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js

## Testing

- Unit tests covering valid Luhn numbers, invalid numbers, edge cases (empty strings, non-numeric input)

## Related Issues

- None directly linked

---
id: cht-core-9227
category: feature
domain: forms-and-reports
subDomain: enketo
issueNumber: 9227
issueUrl: https://github.com/medic/cht-core/issues/9227
title: Add XPath function for Luhn identifier validation in forms
lastUpdated: '2026-08-09'
summary: Added the `cht:validate-luhn` custom XPath function to validate identifiers using the Luhn algorithm directly within Enketo forms, enabling client-side checksum validation to catch typos on ID fields (e.g., South African ID numbers). Shipped in 4.10.0.
services:
  - webapp
techStack:
  - javascript
source_prs:
  - "medic/cht-core#9220"
related_issues: []
---

## Problem

Health workers entering patient identifiers (national IDs, insurance numbers, etc.) in forms had no way to validate checksum digits on the client side. Typos in ID fields would only be caught later during data processing, causing data quality issues and requiring manual correction. The concrete driver was validating South African ID numbers and other Luhn-based identifiers (credit cards, IMEI, tax reference numbers) without bespoke per-form logic (PR #9220).

## Root Cause

The CHT's custom XPath extensions for Enketo did not include a Luhn algorithm implementation. There was no built-in function to validate checksum-based identifiers within form calculations or constraints.

## Solution

Added a `cht:validate-luhn` custom XPath function to the medic XPath extensions, registered as `'cht:validate-luhn': luhn`. Form builders can now use this function in constraint expressions to validate that an entered identifier passes the Luhn checksum. PR #9220 was a focused 2-file change; the same commit also registered `cht:strip-whitespace`, which is why the Luhn check tolerates spaced-out input.

## Code Patterns

- File: `webapp/src/js/enketo/medic-xpath-extensions.js` is where custom XPath functions for Enketo forms are defined
- Pattern: to add a new validation function usable in forms, register it as a custom XPath extension rather than adding server-side validation
- Usage in XForm constraint: `cht:validate-luhn(./patient_id)` returns true/false; the function takes an optional second argument for the expected digit length, so `cht:validate-luhn(./patient_id, 13)` also rejects anything that is not 13 digits long
- This enables instant client-side feedback without a round-trip to the server

## Design Choices

- Implemented as an XPath function rather than a JavaScript validation hook, so it works within the standard XForm constraint mechanism and is accessible to form designers using XLSForm
- Kept the implementation in the existing medic-xpath-extensions file rather than creating a separate module: it is one small function plus the `stripSpace` helper it shares with `cht:strip-whitespace`, which the same commit registered
- Luhn is a checksum designed to catch accidental/transcription errors, not malicious tampering, which fits validating government ID numbers; implementing it as a generic extension (rather than hardcoding validation in one form) makes it reusable across all forms and any Luhn-based identifier (PR #9220)

## Related Files

- webapp/src/js/enketo/medic-xpath-extensions.js
- webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js

## Testing

- Sixteen unit tests in `webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js`, all driving `cht:validate-luhn`: valid and invalid South African ID numbers, a number of the wrong length, non-numeric input, input with embedded and with leading/trailing spaces, Amex / Visa / MasterCard / Discover card numbers, and one valid and one invalid case with no expected length supplied

## Related Issues

- None directly linked

---
id: cht-core-10751
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 10751
issueUrl: https://github.com/medic/cht-core/issues/10751
title: Support case-insensitive and truthy values for unique_tel phone validation via centralized pyxform-boolean library
lastUpdated: '2026-06-22'
summary: Duplicate-phone validation via cht:unique_tel was strictly case-sensitive, so values like "TRUE" (common from spreadsheet auto-formatting) silently bypassed the check. Fixed by centralizing pyxform truthy/falsy parsing into a new library and using it in the phone widget so validation is case-insensitive and ODK-aligned.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - enketo
  - karma
tags:
  - unique_tel
  - phone-widget
  - pyxform
  - form-validation
  - enketo
  - case-insensitive
  - truthy-values
  - odk
related_workflows:
  - form-submission
  - contact-creation
source_pr: medic/cht-core#10756
source_sha: 9f551805f0d779a4e4efc09fd20a47b9361553c5
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/lib/pyxform-boolean.js
  - webapp/src/js/enketo/widgets/phone-widget.js
concepts:
  - Enketo form widgets
  - pyxform truthy/falsy value parsing
  - form attribute validation
  - centralized/shared parsing utility
  - ODK/XForms standards alignment
related_issues: []
stale: false
---

## Problem

Duplicate phone number validation via the cht:unique_tel form attribute was broken whenever authors used non-lowercase values such as <phone cht:unique_tel="TRUE"/>. The uniqueness check silently failed to activate, allowing duplicate phone numbers to be entered. Reported in issue #10751.

## Root Cause

The phone widget parsed the cht:unique_tel attribute by matching only the exact lowercase string 'true'. Valid pyxform/ODK truthy variants (TRUE, True, yes, true()) were treated as falsy, so the uniqueness validation was skipped. Common spreadsheet auto-formatting turning 'true' into 'True'/'TRUE' triggered the bypass.

## Solution

Created a new utility library webapp/src/js/enketo/lib/pyxform-boolean.js that normalizes and checks pyxform-standard truthy/falsy values (true, yes, true()) case-insensitively, with a comment link to the official pyxform constants as a source-of-truth reference. Refactored webapp/src/js/enketo/widgets/phone-widget.js to use this centralized logic, making unique_tel validation case-insensitive and robust.

## Code Patterns

Extract standards-aligned parsing (pyxform truthy/falsy values) into a shared library (webapp/src/js/enketo/lib/pyxform-boolean.js) instead of inline string comparisons inside each widget, so all CHT widgets stay consistent with ODK/pyxform. Include a source-of-truth reference link in the library comments to persist the connection to upstream pyxform constants.

## Design Choices

Per maintainer feedback (dianabarsan), the truthy/falsy logic was centralized into a reusable core library rather than patched inline in the phone widget, ensuring consistency across CHT and alignment with global ODK/pyxform standards while guarding against validation bypasses from spreadsheet auto-formatting.

## Related Files

- webapp/src/js/enketo/lib/pyxform-boolean.js
- webapp/src/js/enketo/widgets/phone-widget.js
- webapp/tests/karma/js/enketo/lib/pyxform-boolean.spec.ts
- webapp/tests/karma/js/enketo/widgets/phone-widget.spec.ts

## Testing

Added a new Karma/Jasmine spec suite for the pyxform-boolean library (pyxform-boolean.spec.ts) covering truthy/falsy edge cases, and updated phone-widget.spec.ts to cover case-insensitive unique_tel validation. Full Enketo regression suite (npm run unit on tests/karma/js/enketo) passed 103/103.

## Related Issues

- #10751: Duplicate phone number validation broken when using <phone cht:unique_tel="TRUE"/>

## Domain Rationale

**Fit:** strong

The change is entirely in Enketo form-widget validation logic — how the phone widget parses the cht:unique_tel form attribute. Although it queries contacts to enforce uniqueness, the bug and fix live in the form widget / pyxform attribute-parsing layer, which is squarely forms-and-reports.

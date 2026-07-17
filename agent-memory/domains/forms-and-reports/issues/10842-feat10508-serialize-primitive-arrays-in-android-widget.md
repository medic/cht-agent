---
id: cht-core-10508
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10508
issueUrl: https://github.com/medic/cht-core/issues/10508
title: Serialize android-app-launcher primitive arrays as space-delimited strings for non-repeat target fields
lastUpdated: '2026-06-22'
summary: The android-app-launcher Enketo widget always inserted returned JSON arrays into repeat groups, so forms could not use built-in XPath functions like selected-at()/count-selected() on list data without a repeat or the android-app-value-list appearance. The widget now deserializes a JSON array of primitives into a space-delimited string when the target field is not a repeat, in a passive backwards-compatible way.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - enketo
  - karma
tags:
  - enketo
  - android-app-launcher
  - widget
  - serialization
  - form-data
  - xpath
  - selected-at
  - count-selected
  - backwards-compatible
related_workflows:
  - form-submission
source_pr: medic/cht-core#10842
source_sha: 018037e56a7fb479cd091d59aafa9b66258b5a58
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/android-app-launcher.js
concepts:
  - Enketo widgets
  - form data serialization
  - XPath multi-select functions (selected-at, count-selected)
  - repeat groups
  - backwards compatibility
related_issues: []
stale: false
---

## Problem

When the android-app-launcher widget received a JSON array of primitive values (strings, numbers, booleans) from an external Android app, the data was always serialized as a JSON array and inserted into a repeat group. Form authors could not use Enketo's built-in XPath functions such as selected-at() and count-selected() on the returned list without introducing a repeat group or the android-app-value-list appearance, making list-style data awkward to consume.

## Root Cause

The widget's data-insertion logic (around webapp/src/js/enketo/widgets/android-app-launcher.js:95) only handled arrays by populating repeats; there was no code path to flatten a primitive array into a single space-delimited string value for a non-repeat target field.

## Solution

Added handling so that when the target output field is NOT a repeat group and the received value is a JSON array of primitives, the array is deserialized into a space-delimited string and stored directly in the named field — the format Enketo's selected-at()/count-selected() expect. A reviewer tweak (jkuester) extended this to also handle arrays nested inside other objects. Existing forms using the android-app-value-list repeat appearance are unaffected.

## Code Patterns

Branch on whether the target field is a repeat; if not, join a primitive array into a space-delimited string (e.g. array.join(' ')) before writing it to the form model, including arrays nested within returned objects. See webapp/src/js/enketo/widgets/android-app-launcher.js.

## Design Choices

Implemented as a passive, backwards-compatible change so existing android-app-value-list repeat-based forms continue to work unchanged. A space-delimited string was chosen because Enketo's multi-select XPath functions (selected-at, count-selected) operate on space-delimited value strings, avoiding the need for a repeat group or special appearance. Support for arrays nested inside objects was added during review to broaden applicability.

## Related Files

- webapp/src/js/enketo/widgets/android-app-launcher.js
- webapp/tests/karma/js/enketo/widgets/android-app-launcher.spec.ts

## Testing

Karma unit tests were added in webapp/tests/karma/js/enketo/widgets/android-app-launcher.spec.ts covering the new primitive-array-to-space-delimited-string behavior and confirming the existing repeat-group behavior is unchanged. Note: the handling for arrays nested inside objects was confirmed manually rather than fully covered by automated tests.

## Related Issues

- #10508: Feature request to deserialize android-app-launcher primitive lists into a space-delimited field so built-in Enketo XPath functions (selected-at, count-selected) work without requiring a repeat group or android-app-value-list appearance

## Domain Rationale

**Fit:** strong

The change modifies an Enketo form widget (android-app-launcher) and concerns how returned data is deserialized into the form model so built-in form XPath functions work — squarely forms-and-reports. The external-app integration is only context; the actual change is form data serialization, so it is not interoperability.

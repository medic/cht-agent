---
id: cht-core-10508
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10508
issueUrl: https://github.com/medic/cht-core/issues/10508
title: Serialize android-app-launcher primitive arrays as space-delimited strings for non-repeat target fields
lastUpdated: '2026-08-09'
summary: The android-app-launcher Enketo widget could only put a returned JSON array into a repeat group, via the android-app-value-list appearance. Aimed at an ordinary field the array was refused outright — assignValueToInput logged "value is an array" and wrote nothing — so forms could not use built-in XPath functions like selected-at()/count-selected() on list data. The widget now deserializes a JSON array of primitives into a space-delimited string when the target field is not a repeat, in a passive backwards-compatible way.
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

When the android-app-launcher widget received a JSON array of primitive values (strings, numbers, booleans) from an external Android app, the only way to consume it was a repeat group via the android-app-value-list / android-app-object-list appearances. Form authors could not use Enketo's built-in XPath functions such as selected-at() and count-selected() on the returned list without introducing a repeat group or the android-app-value-list appearance, making list-style data awkward to consume.

## Root Cause

The widget's data-insertion logic only handled arrays by populating repeats (the repeat wiring the issue links to, `processRepeatGroup`/`assignDataValueToRepeatGroup`); at the point where a value is finally written to a field — `assignValueToInput` — an array simply hit the "cannot set value, value is an array" bail-out. There was no code path to flatten a primitive array into a single space-delimited string value for a non-repeat target field.

## Solution

Added a join at the single value-assignment chokepoint (assignValueToInput): if the incoming value is an array whose items are all non-objects, it is flattened with array.join(' ') before being written to the field — the format Enketo's selected-at()/count-selected() expect. No repeat detection is needed: the repeat paths (assignDataValueToRepeatGroup, assignDataObjectToRepeatGroup) hand one element at a time to the same function, so existing forms using the android-app-value-list / android-app-object-list repeat appearances are unaffected. Because every value funnels through assignValueToInput, arrays reached via the nested-object path (processOutputSubLevels) are covered by the same four lines.

## Code Patterns

Normalize at the one place every value passes through rather than branching on the target's shape: assignValueToInput in webapp/src/js/enketo/widgets/android-app-launcher.js joins any all-primitive array with ' ' before writing it to the form model. Repeat handling stays passive for free, because the repeat helpers only ever pass individual elements down to the same function — no repeat check appears in the code.

## Design Choices

Implemented as a passive, backwards-compatible change so existing android-app-value-list repeat-based forms continue to work unchanged. A space-delimited string was chosen because Enketo's multi-select XPath functions (selected-at, count-selected) operate on space-delimited value strings, avoiding the need for a repeat group or special appearance. Placing the join at the shared assignment chokepoint rather than adding a repeat/appearance check keeps the change to four lines and covers arrays nested inside returned objects at no extra cost.

## Related Files

- webapp/src/js/enketo/widgets/android-app-launcher.js
- webapp/tests/karma/js/enketo/widgets/android-app-launcher.spec.ts

## Testing

One Karma unit test was added in webapp/tests/karma/js/enketo/widgets/android-app-launcher.spec.ts — 'should set output field as space-delimited string when target is not a repeat' — covering the new primitive-array-to-space-delimited-string behavior; the pre-existing repeat-group tests in the same spec were left untouched and continue to pin that path. Note: the handling for arrays nested inside objects has no dedicated test and was confirmed manually.

## Related Issues

- #10508: Feature request to deserialize android-app-launcher primitive lists into a space-delimited field so built-in Enketo XPath functions (selected-at, count-selected) work without requiring a repeat group or android-app-value-list appearance

## Domain Rationale

**Fit:** strong

The change modifies an Enketo form widget (android-app-launcher) and concerns how returned data is deserialized into the form model so built-in form XPath functions work — squarely forms-and-reports. The external-app integration is only context; the actual change is form data serialization, so it is not interoperability.

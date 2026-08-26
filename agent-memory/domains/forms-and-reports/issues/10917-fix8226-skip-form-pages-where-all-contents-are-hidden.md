---
id: cht-core-8226
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8226
issueUrl: https://github.com/medic/cht-core/issues/8226
title: Skip Enketo form pages for top-level groups with the 'hidden' appearance via new HiddenGroup widget
lastUpdated: '2026-08-18'
summary: Enketo rendered empty, navigable pages for groups whose contents were all hidden (e.g. a top-level group with the `hidden` appearance), producing blank pages and blocking use of the db-object-widget to load contact data into a hidden group. A new HiddenGroup widget adds the `disabled` class to such groups so Enketo's pager skips them during navigation.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - enketo
  - xlsform
tags:
  - enketo
  - form-widget
  - hidden-group
  - field-list
  - form-navigation
  - db-object-widget
  - form-rendering
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#10917
source_sha: 23225a57d7e446f21d124ddc1463fdf19cd2fafa
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/hidden-group.js
  - webapp/src/js/enketo/widgets.js
  - webapp/tests/karma/js/enketo/widgets/hidden-group.spec.ts
concepts:
  - Enketo widget extension mechanism
  - form page navigation (pager)
  - field-list groups
  - hidden appearance
  - skipping disabled/non-relevant groups
  - widget registration
related_issues:
  - cht-core-4543
stale: false
---

## Problem

When a `field-list` group had the `hidden` appearance (or all of its contents were hidden), Enketo still rendered an empty, navigable page for that group. Hiding a section such as the `inputs` group of a person-create form left several empty pages during form navigation (issue #4543), and it was impossible to use the db-object-widget to transitively load contact data (e.g. a parent contact's name) into a hidden top-level group (issue #8226).

## Root Cause

Enketo's pager only skips pages for groups it considers non-relevant or disabled. A group with the `hidden` appearance has its contents visually hidden via CSS, but the group element itself is not marked disabled, so the pager still treats it as a real page and renders it as an empty page.

## Solution

Added a new Enketo widget (HiddenGroup, in webapp/src/js/enketo/widgets/hidden-group.js) whose selector is `.or-group-data.or-appearance-hidden` — a data group carrying the `hidden` appearance — and which adds the `disabled` class to every group it matches, leveraging Enketo's existing behavior of skipping disabled groups during navigation. The widget is registered in webapp/src/js/enketo/widgets.js, which pulls it in by module path — `require( './widgets/hidden-group' )` — rather than by the exported `HiddenGroup` name. Review loosened that matcher, but not to "any group with the `hidden` appearance": the `field-list` requirement was replaced by `.or-group-data`, so the selector is still two classes, which is why the Karma spec asserts a group carrying only one of them does not match.

## Code Patterns

Implement form-rendering tweaks as Enketo widgets (class with selector + name) registered in webapp/src/js/enketo/widgets.js, rather than patching Enketo core. The widget integrates with Enketo by toggling DOM state (adding the `disabled` class) so existing pager logic skips the group. Unit-test widgets with Karma specs in webapp/tests/karma/js/enketo/widgets/.

## Design Choices

Reused Enketo's own widget extension point and its existing 'skip disabled groups' pager behavior instead of modifying Enketo's pager directly, keeping the fix minimal and consistent with non-relevant/disabled handling. Following review (jkuester), the selector dropped its `field-list` requirement and landed as `.or-group-data.or-appearance-hidden`. That generalised the fix without making it unconditional — still two classes, which is why the Karma spec asserts a group carrying only one of them does not match. (The widget landed as `HiddenGroup` in `webapp/src/js/enketo/widgets/hidden-group.js`; the narrower field-list name it carried earlier in review never reached the repo.)

## Related Files

- webapp/src/js/enketo/widgets/hidden-group.js
- webapp/src/js/enketo/widgets.js
- webapp/tests/karma/js/enketo/widgets/hidden-group.spec.ts
- tests/e2e/default/enketo/db-object-widget.wdio-spec.js
- tests/e2e/default/enketo/forms/db-object-form.xlsx
- tests/e2e/default/enketo/forms/db-object-form.xml

## Testing

Added Karma unit tests (webapp/tests/karma/js/enketo/widgets/hidden-group.spec.ts) covering the selector (matches a group only when both `or-group-data` and `or-appearance-hidden` are present) and the `disabled`-class behaviour. The existing db-object-widget e2e fixture (db-object-form.xlsx/.xml) was reworked so the `select-contact` field sits in a hidden top-level group — the scenario from #8226 — and the e2e spec's expected doc shape was updated accordingly, confirming contact data still loads through a group the pager now skips. Neither that e2e spec nor its fixtures were newly created here — they are modified, unlike the Karma spec above, which this PR adds — and the e2e makes no direct assertion about page count or navigation.

## Related Issues

- #8226: Support loading contact data via the db-object-widget into a hidden top-level group
- #4543: Hiding a form section with the `hidden` appearance leaves empty pages for its inner groups during navigation

## Domain Rationale

**Fit:** strong

The PR changes how Enketo renders and navigates form pages — adding a widget that skips groups whose contents are all hidden. This is squarely form rendering/behavior, not sync, config, or contacts (even though the motivating use case involves loading contact data).

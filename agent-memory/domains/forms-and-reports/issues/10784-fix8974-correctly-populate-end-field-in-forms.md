---
id: cht-core-8974
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8974
issueUrl: https://github.com/medic/cht-core/issues/8974
title: Fix `end` meta field always matching `start` by dispatching enketo-core's native `before-save` DOM event on form save
lastUpdated: '2026-06-22'
summary: The `end` meta timestamp in CHT forms always equalled `start` because the save path fired a jQuery `beforesave` trigger that never reached enketo-core's native `before-save` listener. Fixed by dispatching a native `before-save` CustomEvent on the form element so enketo-core updates the `end` timestamp.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo-core
  - jquery
  - dom-events
tags:
  - enketo
  - forms
  - meta-fields
  - before-save
  - dom-events
  - jquery-migration
  - timestamps
  - form-save
related_workflows:
  - form-submission
source_pr: medic/cht-core#10784
source_sha: dcde1193c2bc00565d716adb304bf9b27001173e
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/enketo.service.ts
  - webapp/src/ts/modules/contacts/contacts-edit.component.ts
  - webapp/src/types/enketo-core.d.ts
concepts:
  - form meta fields (start/end timestamps)
  - native DOM CustomEvent dispatch vs jQuery .trigger()
  - enketo-core integration
  - prepareForSave lifecycle hook
related_issues: []
stale: false
---

## Problem

The `end` meta field in CHT forms always recorded (almost) the exact same value as `start`, regardless of how long the user took to fill out the form. This affected both app forms and contact forms, corrupting any form-duration/completion-time analytics derived from these timestamps.

## Root Cause

In `prepareForSave`, CHT fired `$('form.or').trigger('beforesave')`, which had two defects: (1) the event name `beforesave` was missing the hyphen — enketo-core's event.js defines the event as `before-save`; (2) jQuery's `.trigger()` only invokes jQuery-bound listeners and never reaches native `addEventListener` listeners. enketo-core's preload.js updates the `end` value inside a native `before-save` DOM listener (`form.model.evaluate('now()', 'string')`). Since enketo-core 7.x (the Enketo Uplift in CHT 4.0.0) dropped jQuery entirely, that native callback silently never executed, leaving `end` frozen at its preloaded value equal to `start`.

## Solution

Replaced the jQuery trigger with a native DOM dispatch on the correct form element in enketo.service.ts: `form.view.html.dispatchEvent(new CustomEvent('before-save', { bubbles: true }))`, using the correctly hyphenated event name enketo-core listens for. Applied the same fix in the contacts-edit component (contact form path), and updated the enketo-core TypeScript type declarations to support the dispatch.

## Code Patterns

When integrating with enketo-core (post-jQuery, 7.x+), dispatch native DOM CustomEvents instead of jQuery `.trigger()`, and use the exact hyphenated event names from enketo-core's event.js: `form.view.html.dispatchEvent(new CustomEvent('before-save', { bubbles: true }))` in webapp/src/ts/services/enketo.service.ts (mirrored in webapp/src/ts/modules/contacts/contacts-edit.component.ts).

## Design Choices

Native DOM dispatch was mandatory because enketo-core 7.x removed jQuery, so jQuery-bound triggers can no longer reach the library's native listeners. Relying on enketo-core's own documented `before-save` event (rather than a CHT-side workaround to compute the timestamp) couples the behavior to the library and, per the reviewer, makes future regressions much harder.

## Related Files

- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/src/types/enketo-core.d.ts
- webapp/tests/karma/ts/services/enketo.service.spec.ts
- webapp/tests/karma/ts/modules/contacts/contacts-edit.component.spec.ts

## Testing

Karma unit tests added/updated for both enketo.service and the contacts-edit component to assert the native `before-save` event is dispatched on save. Additionally manually tested with both a contact form and an app form, confirming `end` is now correctly populated and diverges from `start`.

## Related Issues

- #8974: `end` meta field always records (almost) the same value as `start` regardless of how long the user takes to fill out the form

## Domain Rationale

**Fit:** strong

The PR fixes how a form meta field (the `end` timestamp) is captured during form save in the Enketo form engine, which is core form-handling behavior. It is not about offline sync, permissions, or config, so forms-and-reports is a squarely correct fit.

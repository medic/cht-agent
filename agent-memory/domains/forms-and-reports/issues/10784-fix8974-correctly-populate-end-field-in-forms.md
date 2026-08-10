---
id: cht-core-8974
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8974
issueUrl: https://github.com/medic/cht-core/issues/8974
title: Fix `end` meta field always matching `start` by dispatching enketo-core's native `before-save` DOM event on form save
lastUpdated: '2026-08-10'
summary: The `end` meta timestamp in CHT forms always equalled `start` because the save path fired a jQuery `beforesave` trigger that never reached enketo-core's native before-save listener. Fixed by dispatching enketo-core's own `events.BeforeSave()` on the form element so enketo-core updates the `end` timestamp.
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
  - native DOM event dispatch vs jQuery .trigger()
  - library-supplied event factories over hand-built CustomEvents
  - enketo-core integration
  - declare module shims for untyped deep imports
  - prepareForSave lifecycle hook
related_issues: []
stale: false
---

## Problem

The `end` meta field in CHT forms always recorded (almost) the exact same value as `start`, regardless of how long the user took to fill out the form. This affected both app forms and contact forms, corrupting any form-duration/completion-time analytics derived from these timestamps.

## Root Cause

In `prepareForSave`, CHT fired `$('form.or').trigger('beforesave')`, which had two defects: (1) the event name `beforesave` was missing the hyphen — enketo-core's event.js defines the event as `before-save`; (2) jQuery's `.trigger()` only invokes jQuery-bound listeners and never reaches native `addEventListener` listeners. enketo-core's preload.js updates the `end` value inside a native `before-save` DOM listener (`form.model.evaluate('now()', 'string')`). Since enketo-core 7.x (the Enketo Uplift in CHT 4.0.0) dropped jQuery entirely, that native callback silently never executed, leaving `end` frozen at its preloaded value equal to `start`.

## Solution

Replaced the jQuery trigger with a native DOM dispatch on the correct form element in enketo.service.ts, importing enketo-core's own event factory rather than hand-rolling the event:

```ts
import events from 'enketo-core/src/js/event';
...
form.view.html.dispatchEvent(events.BeforeSave());
```

Letting `events.BeforeSave()` build the event means the event name and options come from the library, so a rename upstream is a type error rather than a silent no-op. The same fix was applied in the contacts-edit component (contact form path), and a new declaration file `webapp/src/types/enketo-core.d.ts` was added to type the otherwise-untyped `enketo-core/src/js/event` module (`BeforeSave: () => CustomEvent`).

## Code Patterns

When integrating with enketo-core (post-jQuery, 7.x+), dispatch native DOM events instead of jQuery `.trigger()`, and get the event from enketo-core's own `src/js/event` factories rather than constructing a `CustomEvent` by hand — the event name and options then cannot drift out of sync with the library. In cht-core that is `form.view.html.dispatchEvent(events.BeforeSave())`, which today lives only in webapp/src/ts/services/enketo.service.ts; this PR also placed a copy in webapp/src/ts/modules/contacts/contacts-edit.component.ts, which #11256 later removed when it routed the contact save path through the enketo service.

Untyped deep imports from a JS dependency need a matching `declare module` block under webapp/src/types/ before TypeScript will accept them.

## Design Choices

Native DOM dispatch was mandatory because enketo-core 7.x removed jQuery, so jQuery-bound triggers can no longer reach the library's native listeners. Relying on enketo-core's own documented `before-save` event (rather than a CHT-side workaround to compute the timestamp) couples the behavior to the library and, per the reviewer, makes future regressions much harder.

## Related Files

- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/modules/contacts/contacts-edit.component.ts (its copy of the dispatch was removed by #11256)
- webapp/src/types/enketo-core.d.ts (added by this PR)
- webapp/tests/karma/ts/services/enketo.service.spec.ts
- webapp/tests/karma/ts/modules/contacts/contacts-edit.component.spec.ts

## Testing

Karma unit tests added/updated for both enketo.service and the contacts-edit component to assert the before-save event is dispatched on save. Additionally manually tested with both a contact form and an app form, confirming `end` is now correctly populated and diverges from `start`.

## Related Issues

- #8974: `end` meta field always records (almost) the same value as `start` regardless of how long the user takes to fill out the form

## Domain Rationale

**Fit:** strong

The PR fixes how a form meta field (the `end` timestamp) is captured during form save in the Enketo form engine, which is core form-handling behavior. It is not about offline sync, permissions, or config, so forms-and-reports is a squarely correct fit.

---
id: cht-core-9301
category: feature
domain: forms-and-reports
subDomain: enketo
issueNumber: 9301
issueUrl: https://github.com/medic/cht-core/issues/9301
title: Expose user's contact summary when filling out forms
lastUpdated: '2026-08-18'
summary: Made the logged-in user's contact summary data available to Enketo forms via a named external data instance, so forms can reference the user's own summary fields (e.g. stock levels) during data entry, and via a `userSummary` variable in the form-visibility context expressions that decide which forms are listed.
services:
  - webapp
techStack:
  - typescript
  - angular
source_prs:
  - "medic/cht-core#9824"
related_issues:
  - cht-core-9269
---

## Problem

Deployments using stock monitoring stored inventory data in a CHW's contact summary. When the CHW filled out a form to administer medication, the form had no way to check whether the item was in stock because only the patient's contact summary was accessible, not the user's own summary.

## Root Cause

The Enketo form rendering pipeline only injected the subject contact's summary into the form context. There was no mechanism to also inject the current user's contact summary data. Separately, the contact detail page did not react to synced-in changes, so it failed to auto-display incoming reports for relevant contacts (#9825, fixed in the same PR).

## Solution

Added a dedicated `user-contact-summary.service.ts` that resolves the logged-in user's contact (via user-settings.service → contact-view-model-generator.service, with target docs from target-aggregates.service), runs it through the existing contact-summary.service, and caches the result behind cache.service with invalidation driven by contact-change-filter.service. The cached summary is surfaced two ways: as a `user-contact-summary` external data instance available to form expressions during data entry, and as a `userSummary` variable in the form-visibility context expressions evaluated by xml-forms.service.ts (PR #9824), wired through the enketo, form, and xml-forms services. The standalone cht-form web component does not get the user summary: its change here is that the existing contact-summary instance gained an explicit id (`{ id: 'contact-summary', context: value }`), so `user-contact-summary` appears nowhere in app.component.ts, then or on master. The same PR also updated contact-change-filter / contacts-content so the contact detail page auto-refreshes when relevant incoming reports arrive (#9825).

## Code Patterns

- When forms need data beyond the subject contact, expose it via named external data instances and/or context variables rather than custom variables
- The user's contact summary is computed once and held in a `CacheService` entry that outlives any single form session — it is not re-fetched per question or per form open, and is invalidated only when `ContactChangeFilterService.isRelevantChange()` says a change affects the user's own contact
- Inside a form, read the user's summary from the `user-contact-summary` external data instance; to gate whether a form is offered at all, use `userSummary` in the form's context expression (bound in `xml-forms.service.ts#evaluateExpression` alongside `contact`, `summary` and `user`)
- Compute-and-cache a derived view for the current user: resolve user → contact (user-settings.service + contact-view-model-generator.service, plus target-aggregates.service for target docs) → contact-summary.service → cache in a dedicated service (user-contact-summary.service.ts)
- The standalone `webapp/web-components/cht-form/src/app.component.ts` takes the subject summary as a `contactSummary` input and tags it with the instance id this PR gave it (`{ id: 'contact-summary', context: value }`), then hands it to `EnketoService.renderForm`, which injects it as that named instance. It does **not** receive the user summary: the `user-contact-summary` instance is created only in the webapp's `form.service.ts` (whose `instance[id="..."]` probe the web component never runs, since it bypasses `FormService`), and `xml-forms.service.ts` exposes the same data to context expressions as `userSummary`, so an embedded form cannot read it
- File: `webapp/src/ts/services/user-contact-summary.service.ts` fetches and caches the user's own contact summary

## Design Choices

- Exposed the user summary via a dedicated `user-contact-summary` instance, and as a separate `userSummary` binding in the form-visibility context rather than overloading the existing `summary` (subject) binding, to avoid ambiguity between subject and user data and to give form authors flexibility in how they consume it
- A dedicated caching service avoids recomputing the potentially expensive summary every time a form opens
- Reused the existing contact-summary.service to keep summary-computation logic single-sourced rather than duplicating it for the user-contact case

## Related Files

- webapp/src/ts/services/user-contact-summary.service.ts
- webapp/src/ts/services/contact-summary.service.ts
- webapp/src/ts/services/contact-view-model-generator.service.ts
- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/xml-forms.service.ts
- webapp/src/ts/services/lineage-model-generator.service.ts (touched by the PR for an unrelated typing tidy-up; not part of the user-summary resolution path)
- webapp/src/ts/services/user-settings.service.ts
- webapp/src/ts/services/contact-change-filter.service.ts
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/web-components/cht-form/src/app.component.ts
- tests/e2e/default/enketo/users-contact-summary.wdio-spec.js

## Testing

- Unit tests for the user contact summary service
- Unit tests verifying the enketo/form services inject the `user-contact-summary` instance, and that xml-forms binds `userSummary` into the form-visibility context expression
- Updated karma specs for enketo, form, xml-forms, contact-change-filter, and contacts-content, plus a karma fixture exercising form-instance injection and an updated cht-form app.component spec
- E2E spec `tests/e2e/default/enketo/users-contact-summary.wdio-spec.js` with a dedicated test form verifies the summary surfaces in forms

## Related Issues

- #9269: Expose the user's target documents into the contact summary
- #9825: Contact detail page does not automatically display incoming reports for relevant contacts (fixed in PR #9824 alongside this feature)

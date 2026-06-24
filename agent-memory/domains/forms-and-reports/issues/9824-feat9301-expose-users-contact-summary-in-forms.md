---
id: cht-core-9301
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 9301
issueUrl: https://github.com/medic/cht-core/issues/9301
title: Expose logged-in user's contact summary to forms via `user.summary` context variable and `user-contact-summary` form instance
lastUpdated: '2026-06-22'
summary: Forms had no way to read the logged-in user's contact summary, blocking deployment logic such as stock monitoring (e.g. knowing if a medication is in stock before administering it). Adds a user-contact-summary service that computes and caches the current user's contact summary and injects it into forms as both a `user-contact-summary` instance and the `user.summary` context variable, and fixes contact detail pages not auto-refreshing on incoming reports.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - rxjs
tags:
  - contact-summary
  - enketo
  - form-context
  - user-summary
  - caching
related_workflows:
  - form-submission
source_pr: medic/cht-core#9824
source_sha: d5ceadec239e1c5e4fc9603dd274fdb30584a3a2
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/user-contact-summary.service.ts
  - webapp/src/ts/services/contact-summary.service.ts
  - webapp/src/ts/services/enketo.service.ts
  - webapp/src/ts/services/form.service.ts
  - webapp/src/ts/services/xml-forms.service.ts
  - webapp/src/ts/services/contact-change-filter.service.ts
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
  - webapp/web-components/cht-form/src/app.component.ts
concepts:
  - form context variables
  - enketo external data instances
  - contact summary computation
  - computed-value caching for the current user
  - change-feed-driven contact detail refresh
related_issues: []
stale: false
---

## Problem

Forms could not access the logged-in user's contact summary, so deployments (e.g. stock monitoring) could not write form logic that depends on it — for instance, branching on whether a medication is in stock before administering it. Separately, the webapp contact detail page did not automatically display incoming reports for relevant contacts: it failed to react to synced-in changes (#9825).

## Root Cause

The form-filling pipeline (enketo/xml-forms/form services) never computed or injected the current user's contact summary into form context or content, so the data was simply unavailable to form logic. For the detail-page bug, the contact-change-filter logic did not flag incoming reports as relevant changes to the displayed contact, so contacts-content did not refresh the view.

## Solution

Added a new `user-contact-summary.service.ts` that resolves the logged-in user's contact (via user-settings.service and lineage-model-generator), runs it through the existing contact-summary.service, and caches the result. The cached summary is surfaced to forms two ways: as a `user-contact-summary` external data instance in form content and as the `user.summary` variable in form context, wired through enketo.service, form.service and xml-forms.service, and mirrored in the standalone cht-form web component. The contact-change-filter / contacts-content changes make the contact detail page refresh automatically when relevant incoming reports arrive.

## Code Patterns

Compute-and-cache a derived view for the current user: resolve user → contact (user-settings.service + lineage-model-generator.service) → contact-summary.service → cache in a dedicated service (user-contact-summary.service.ts). Inject the cached value into Enketo both as a named external data instance (`user-contact-summary`) and as a context variable (`user.summary`) within enketo.service/xml-forms.service/form.service, and replicate the same wiring in web-components/cht-form/src/app.component.ts so embedded forms behave identically.

## Design Choices

A dedicated caching service avoids recomputing the potentially expensive summary every time a form opens. Exposing the value both as a form instance and as a `user.summary` context variable gives form authors flexibility in how they consume it. Reusing the existing contact-summary.service keeps summary-computation logic single-sourced instead of duplicating it for the user-contact case.

## Related Files

- webapp/src/ts/services/user-contact-summary.service.ts
- webapp/src/ts/services/contact-summary.service.ts
- webapp/src/ts/services/contact-view-model-generator.service.ts
- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/xml-forms.service.ts
- webapp/src/ts/services/lineage-model-generator.service.ts
- webapp/src/ts/services/user-settings.service.ts
- webapp/src/ts/services/contact-change-filter.service.ts
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/web-components/cht-form/src/app.component.ts
- tests/e2e/default/enketo/users-contact-summary.wdio-spec.js

## Testing

Added unit (karma) and e2e (wdio) coverage. New e2e spec tests/e2e/default/enketo/users-contact-summary.wdio-spec.js with a dedicated test form (users-contact-summary.xml) and config verifies the summary surfaces in forms; common.wdio.page.js updated. New karma spec user-contact-summary.spec.spec.ts covers the new service, with updated specs for enketo, form, xml-forms, contact-change-filter and contacts-content, plus a karma fixture visit-contact-summary.xml exercising form-instance injection and an updated cht-form app.component spec.

## Related Issues

- #9301: deployments need forms to access the logged-in user's contact summary (e.g. stock monitoring to know if a medication is in stock)
- #9825: contact detail page does not automatically display incoming reports for relevant contacts (not responsive to synced-in changes)

## Domain Rationale

**Fit:** strong

The headline feature (#9301) adds a new capability to the form-filling pipeline — exposing the logged-in user's contact summary as a `user.summary` form-context variable and a `user-contact-summary` form-content instance — with the bulk of new wiring in enketo/form/xml-forms services and the cht-form component. It heavily touches contacts services (contact-summary, view-model/lineage generators) because the data originates there, so a reviewer could defensibly re-bin to contacts; chosen forms-and-reports because the novel surface lives in form context/content.

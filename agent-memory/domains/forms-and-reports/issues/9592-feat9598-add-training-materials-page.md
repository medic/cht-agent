---
id: cht-core-9598
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 9598
issueUrl: https://github.com/medic/cht-core/issues/9598
title: Add a dedicated training materials page to browse, sort, paginate, and re-open training cards; make the modal form title/buttons sticky
lastUpdated: '2026-08-10'
summary: Training cards were only reachable through a once-a-day modal, with no place to browse or re-take trainings on demand. This PR adds a routable training materials page (sorted by start date, paginated infinite scroll, openable multiple times a day) reached from the hamburger menu, refactors form rendering into a shared component used by both the page and the modal, adds a quit-confirmation modal, and makes the modal's form title and action buttons sticky.
services:
  - webapp
  - api
techStack:
  - typescript
  - angular
  - ngrx
  - less
  - enketo
  - webdriverio
tags:
  - training-cards
  - training-materials
  - pagination
  - infinite-scroll
  - enketo
  - modal
  - navigation
  - i18n
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#9592
source_sha: e33cd8738be9bbe1e3c34566fe07d7bf9fa9da6f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/trainings/trainings.component.ts
  - webapp/src/ts/modules/trainings/trainings-content.component.ts
  - webapp/src/ts/modules/trainings/trainings.routes.ts
  - webapp/src/ts/modules/trainings/trainings-route.guard.provider.ts
  - webapp/src/ts/components/training-cards-form/training-cards-form.component.ts
  - webapp/src/ts/modals/training-cards/training-cards.component.ts
  - webapp/src/ts/modals/training-cards-confirm/training-cards-confirm.component.ts
  - webapp/src/ts/services/training-cards.service.ts
  - webapp/src/ts/training-card.guard.provider.ts
concepts:
  - angular-routing
  - route-guards
  - ngrx-state-management
  - enketo-form-rendering
  - form-to-report-submission
  - infinite-scroll-pagination
  - modal-vs-page-rendering
  - shared-component-refactor
  - internationalization
related_issues: []
stale: false
---

## Problem

Training cards could only be accessed via a modal that surfaced once per day, so CHWs had no dedicated place to browse all available training materials, view trainings sorted/paginated, or re-open a training on demand (multiple times a day). The training option was not consistently exposed in the menu. In the modal itself, the form title and action buttons were not sticky, so on long content they scrolled out of view, making it hard to submit or quit. There was also no consistent quit-confirmation flow, and forms with no defined title rendered with nothing to identify them.

## Root Cause

Architecturally, training cards were implemented solely as a one-time daily modal gated by TrainingCardsService, with no routable trainings module, no list/pagination view, and no shared rendering component. Form rendering logic lived inside the modal rather than a reusable component, so a full page could not reuse it. The modal layout did not pin the title/buttons, and there was no fallback to form ID when a title was absent.

## Solution

Added a new trainings module (webapp/src/ts/modules/trainings/) exposing a routable training materials page that lists trainings sorted by start date with infinite-scroll pagination (page size 50) and allows opening trainings multiple times a day. Extracted form rendering into a shared training-cards-form component reused by both the modal and the page. Added a training-cards-confirm modal so quitting a training prompts the same confirmation message/title in both contexts. Made the modal's form title and buttons sticky via CSS. Added a trainings-route.guard.provider.ts for the new page and extended the existing training-card.guard.provider.ts (added by #9512), and suppressed the daily modal while on the training materials page via hideTraining: true on the trainings routes. Wired NgRx actions/reducers/selectors for trainings state, always surfaced the training materials option in the hamburger menu, supported both old and new nav, fell back to form ID when the title is undefined, and added translations across 7 languages (en, es, fr, hi, id, ne, sw).

## Code Patterns

Shared form component reused across surfaces: webapp/src/ts/components/training-cards-form/training-cards-form.component.ts is consumed by both webapp/src/ts/modals/training-cards/training-cards.component.ts and webapp/src/ts/modules/trainings/trainings-content.component.ts, avoiding duplicated Enketo rendering logic. Route/access gating via guard providers: the new trainings-route.guard.provider.ts alongside the pre-existing training-card.guard.provider.ts, plus route data (hideTraining) read by TrainingCardsService to suppress the daily modal on a given route. NgRx state slice for trainings wired through actions/global.ts, reducers/global.ts, and selectors/index.ts. Infinite-scroll pagination (50/page) in trainings.component.ts. Shared confirmation modal pattern (training-cards-confirm) parameterized for reuse by page and modal.

## Design Choices

Refactored common rendering into one shared component so the page and modal stay behaviorally identical and avoid drift. Kept the modal as once-per-day but allowed the page to be opened multiple times a day, matching the different UX intents (nudge vs. on-demand library). Shared a single confirmation message/title across both surfaces for consistency. Fell back to form ID when the title is missing as graceful degradation. Always showed the menu entry regardless of whether trainings exist, for discoverability. Made the title/buttons sticky rather than restructuring scroll containers, to keep submit/quit reachable on long forms. Supported both old and new nav to remain backward compatible.

## Related Files

- webapp/src/ts/modules/trainings/trainings.component.ts
- webapp/src/ts/modules/trainings/trainings.component.html
- webapp/src/ts/modules/trainings/trainings-content.component.ts
- webapp/src/ts/modules/trainings/trainings-content.component.html
- webapp/src/ts/modules/trainings/trainings.routes.ts
- webapp/src/ts/modules/trainings/trainings-route.guard.provider.ts
- webapp/src/ts/components/training-cards-form/training-cards-form.component.ts
- webapp/src/ts/components/training-cards-form/training-cards-form.component.html
- webapp/src/ts/modals/training-cards/training-cards.component.ts
- webapp/src/ts/modals/training-cards-confirm/training-cards-confirm.component.ts
- webapp/src/ts/services/training-cards.service.ts
- webapp/src/ts/training-card.guard.provider.ts
- webapp/src/ts/components/sidebar-menu/sidebar-menu.component.ts
- webapp/src/ts/app-routing.module.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/ts/selectors/index.ts
- webapp/src/css/modal.less
- api/resources/translations/messages-en.properties

## Testing

Added e2e coverage with a new tests/e2e/default/training-materials/training-materials.wdio-spec.js plus test XForms (first-training.xml, second-training.xml, expired-training.xml), updated the enketo training-cards.wdio-spec.js and its page object (tests/page-objects/default/enketo/training-cards.wdio.page.js), extended common.wdio.page.js, registered the new suite in suites.js, and adjusted the service-worker e2e spec. Added/updated Karma unit tests for the new shared form component (training-cards-form.component.spec.ts), the new trainings module (trainings.component.spec.ts, trainings-content.component.spec.ts), the sidebar menu (sidebar-menu.component.spec.ts), and the training-cards modal, service and selectors.

## Related Issues

- #9598: Add a training materials page so CHWs can browse, paginate, and re-open training cards on demand

## Domain Rationale

**Fit:** strong

Training cards are Enketo XForms (defined as XML XForms and rendered via Enketo) whose submission records a report on the Reports list; this PR builds the rendering surface (page + modal) and report-generation flow for those forms, which is squarely forms-and-reports. It touches navigation/UX, but the core mechanic is form rendering and report submission, not config or sync.

Concretely, this is what separates it from its training-card siblings `9512` and `9513`, both graded `weak`: 9512 is a `canDeactivate` guard wired across eight `*.routes.ts` and 9513 is display-frequency gating inside `training-cards.service.ts`, and neither touches form-engine code. This PR adds `webapp/src/ts/components/training-cards-form/training-cards-form.component.ts`, which owns the Enketo render/save lifecycle — it constructs an Enketo form context (an `EnketoFormContext` as of this PR; renamed to `WebappEnketoFormContext` by #9840 when the type became an interface), calls `XmlFormsService.get()` and `FormService.render()`/`FormService.save()`, and implements `renderForm()` and `saveForm()` — plus three real XForm fixtures under `tests/e2e/default/training-materials/forms/`.

---
id: cht-core-8119
category: improvement
domain: forms-and-reports
domainFit: weak
issueNumber: 8119
issueUrl: https://github.com/medic/cht-core/issues/8119
title: Add route guard to show the 'lose your progress' confirmation before navigating away from an open training card
lastUpdated: '2026-08-18'
summary: The training-card progress-loss confirmation previously only appeared when closing via the Cancel/X buttons. This PR adds an Angular route guard so the same confirmation is shown when the user navigates to another route or uses the browser/Android back button while a training card is open.
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
  - enketo
tags:
  - training-cards
  - route-guard
  - navigation-confirmation
  - unsaved-changes
  - canDeactivate
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9512
source_sha: 74292df6c040b331c545ad7c4374809e4945600e
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/training-card.guard.provider.ts
  - webapp/src/ts/services/training-cards.service.ts
  - webapp/src/ts/modals/training-cards/training-cards.component.ts
  - webapp/src/ts/services/modal.service.ts
  - webapp/src/ts/actions/global.ts
  - webapp/src/ts/reducers/global.ts
  - webapp/src/ts/selectors/index.ts
concepts:
  - angular route guard
  - navigation confirmation / unsaved-changes protection
  - ngrx global state (actions/reducer/selector)
  - shared confirmation modal
  - training cards (enketo forms)
related_issues: []
stale: false
---

## Problem

The progress-loss confirmation ('This training is not finished. You will lose your progress if you leave now. Are you sure you want to leave?') only triggered on the training card's Cancel and X buttons. A user with a training card open could navigate away — via the URL bar, in-app links, or the browser/Android hardware back button — and silently lose their in-progress training with no warning.

## Root Cause

Exit handling for training cards was confined to the modal component's explicit Cancel/X actions. There was no guard on Angular router navigation, so route changes and back-button navigation bypassed the confirmation entirely.

## Solution

Introduced a training-card route guard provider (webapp/src/ts/training-card.guard.provider.ts) registered on the app's feature routes (about, analytics, configuration-user, contacts, messages, privacy-policy, reports, tasks). New global NgRx state tracks whether a training card is open/in-progress; it lives in the existing actions/global.ts, reducers/global.ts, and selectors/index.ts, each modified by this PR. When the card is open, the guard blocks the navigation and flips a `showConfirmExit` flag (with the pending `nextUrl`) held in `webapp/src/ts/reducers/global.ts`, which the open training-cards modal renders as the existing confirmation. modal.service.ts gained a `closeOnNavigation` option so the training modal survives the blocked navigation, and the training-cards service opens the modal with `closeOnNavigation: false`.

## Code Patterns

Centralized navigation-blocking pattern: a canDeactivate route guard reads an 'in-progress' flag from NgRx global state (selectors/index.ts backed by reducers/global.ts + actions/global.ts), returns false, and hands the pending URL back through the same state slice so the already-open modal renders the confirmation — rather than intercepting navigation per-component or opening a dialog from inside the guard. The guard is then attached across all feature route configs (*.routes.ts) so one guard enforces consistent confirm-on-leave behavior app-wide. Reference: webapp/src/ts/training-card.guard.provider.ts.

## Design Choices

Chose a single route guard driven by centralized NgRx state over ad-hoc per-component navigation interception, so the confirmation is enforced consistently across every feature route. Reused the existing confirmation modal/message rather than adding a new dialog, keeping UX identical to the Cancel/X flow. Explicitly verified on Firefox/Chrome desktop, CHT Android app, Android Chrome PWA, and Chrome on Android to ensure hardware/browser back-button navigation is also covered.

## Related Files

- webapp/src/ts/training-card.guard.provider.ts
- webapp/src/ts/services/training-cards.service.ts
- webapp/src/ts/modals/training-cards/training-cards.component.ts
- webapp/src/ts/services/modal.service.ts
- webapp/src/ts/actions/global.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/ts/selectors/index.ts
- webapp/src/ts/app.module.ts
- webapp/src/ts/modules/contacts/contacts.routes.ts
- webapp/src/ts/modules/reports/reports.routes.ts
- webapp/src/ts/modules/tasks/tasks.routes.ts
- tests/e2e/default/enketo/training-cards.wdio-spec.js

## Testing

Added/updated e2e coverage in tests/e2e/default/enketo/training-cards.wdio-spec.js to assert the confirmation appears on route navigation and back-button navigation. Updated Karma unit specs for the training-cards component, training-cards service, global reducer, and selectors. The author also manually verified the behavior on Firefox and Chrome desktop, the CHT Android app, the Android Chrome PWA, and Chrome on Android.

## Related Issues

- #8119: Show the training-card progress-loss confirmation when the user navigates to another page (e.g. via the back button), not only when clicking Cancel/X

## Domain Rationale

**Fit:** weak

The mechanism is cross-cutting Angular navigation plumbing (a canDeactivate route guard wired across eight feature modules' *.routes.ts), not form-engine code; it protects an in-progress training-form fill, so forms-and-reports is the least-bad home rather than a principled fit.

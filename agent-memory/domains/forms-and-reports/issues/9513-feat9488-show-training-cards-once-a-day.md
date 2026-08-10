---
id: cht-core-9488
category: feature
domain: forms-and-reports
domainFit: weak
issueNumber: 9488
issueUrl: https://github.com/medic/cht-core/issues/9488
title: Show training cards once per day by persisting last-viewed date in localStorage
lastUpdated: '2026-08-09'
summary: Training cards (Enketo training forms) had no daily throttling and could re-appear repeatedly within the same day. This PR has TrainingCardsService persist the last-viewed date in localStorage under a per-user key and return early unless that stored date is before today, limiting the cards to once per day per user per device.
services:
  - webapp
techStack:
  - typescript
  - angular
  - localstorage
tags:
  - training-cards
  - local-storage
  - onboarding
  - daily-display
  - enketo
related_workflows: []
source_pr: medic/cht-core#9513
source_sha: 40c0d2409db171e9b5bff74eaebf9bff46d66033
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/training-cards.service.ts
  - webapp/src/ts/app.component.ts
concepts:
  - client-side state persistence (localStorage)
  - display frequency throttling / once-per-day gating
  - date-based comparison for display logic
related_issues: []
stale: false
---

## Problem

Training cards had no mechanism limiting how often they appeared, so users could be shown the same training cards repeatedly (e.g., on each app load or re-login within the same day), creating a repetitive onboarding experience.

## Root Cause

The training-cards service did not persist any record of when cards were last viewed, so there was no state to gate display frequency — display was evaluated without a per-day check.

## Solution

TrainingCardsService.displayTrainingCards() now returns early when hasBeenDisplayed() finds a stored last-viewed date that is not before today (both dates normalised to midnight). The date is written to localStorage under a per-user key built by `getLocalStorageKey()` from the constant `STORAGE_KEY_LAST_VIEWED_DATE` (`'training-cards-last-viewed-date'`) suffixed with the username when the modal's afterOpened() first emits, so a card that is opened counts as shown for the rest of the calendar day. The app component only triggers the service; it holds no date logic (its change in this PR merely collapsed the existing privacy-policy and form-id guards into a single condition).

## Code Patterns

Once-per-day client-side gating: persist an ISO date string in localStorage and compare it to the current date — both normalised with setHours(0, 0, 0, 0) — to decide whether to run an action at most once per calendar day; namespace the storage key by username so the cap is per user rather than per browser profile. All of the gating and persistence lives in webapp/src/ts/services/training-cards.service.ts; webapp/src/ts/app.component.ts is only the display trigger.

## Design Choices

Persistence uses localStorage (per-device/browser) rather than the user's CouchDB doc, so the once-a-day cap is local to each device and not synced across devices. The key is namespaced by username, so the cap is per user per device and a shared device does not consume another user's daily showing. This keeps the UX feature lightweight and avoids replication/server changes, at the cost of cards potentially showing once per user per device per day. A missing or unparseable stored date fails open (cards are shown), so a corrupt value never permanently suppresses training.

## Related Files

- webapp/src/ts/services/training-cards.service.ts
- webapp/src/ts/app.component.ts
- webapp/tests/karma/ts/services/training-cards.service.spec.ts
- tests/e2e/default/enketo/training-cards.wdio-spec.js

## Testing

Unit tests in webapp/tests/karma/ts/services/training-cards.service.spec.ts cover the localStorage date-comparison gating logic; the e2e spec tests/e2e/default/enketo/training-cards.wdio-spec.js was updated to verify the once-a-day display behavior. The PR also includes a manual test video demonstrating desktop and mobile views.

## Related Issues

- #9488: show training cards once a day
- cht-docs#1612: documentation update for the training-cards once-a-day behavior

## Domain Rationale

**Fit:** weak

The change is display-frequency gating (when to surface the training card), not form-engine work; forms-and-reports is the least-bad home because the surfaced artifact is a training form.

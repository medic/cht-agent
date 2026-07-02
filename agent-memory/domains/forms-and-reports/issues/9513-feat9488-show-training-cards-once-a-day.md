---
id: cht-core-9488
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 9488
issueUrl: https://github.com/medic/cht-core/issues/9488
title: Show training cards once per day by persisting last-viewed date in localStorage
lastUpdated: '2026-06-22'
summary: Training cards (Enketo training forms) had no daily throttling and could re-appear repeatedly within the same day. This PR persists the last-viewed date in localStorage and only re-displays the cards when that stored date is before the current day, limiting them to once per day per device.
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

Added logic to store the last-viewed date in browser localStorage and compare it against the current date in the training-cards service; the app component only displays the training cards when the stored date is before today, after which the stored date is updated to today.

## Code Patterns

Once-per-day client-side gating: persist a date string in localStorage and compare it to the current date to decide whether to run an action at most once per calendar day. See webapp/src/ts/services/training-cards.service.ts for the date-comparison/persistence logic and webapp/src/ts/app.component.ts for the display trigger.

## Design Choices

Persistence uses localStorage (per-device/browser) rather than the user's CouchDB doc, so the once-a-day cap is local to each device and not synced across devices. This keeps the UX feature lightweight and avoids replication/server changes, at the cost of cards potentially showing once per device per day.

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

**Fit:** strong

Training cards are Enketo-based training forms (the e2e test lives under tests/e2e/default/enketo/) and this PR governs when those forms are surfaced to users; managing display behavior of a first-class forms feature squarely fits forms-and-reports rather than being a least-bad pick.

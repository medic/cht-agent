---
id: cht-core-10208
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10208
issueUrl: https://github.com/medic/cht-core/issues/10208
title: Add admin welcome training card for first-time setup and let training forms load without an associated contact
lastUpdated: '2026-08-14'
summary: First-time admins on a clean CHT install saw no data and no onboarding guidance, and training cards failed with 'Error loading form' for users lacking an associated contact. This PR adds an `admin_welcome` training card to guide admins on populating data and makes training forms exempt from the contact requirement so they always load.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - xml
  - xlsform
tags:
  - training-cards
  - forms
  - onboarding
  - requires-contact
  - first-time-setup
  - admin
related_workflows:
  - form-submission
source_pr: medic/cht-core#10290
source_sha: 1658432f7b35720810d55eb398066a1bad9e2b29
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/form.service.ts
  - config/default/forms/training/admin_welcome.xml
  - config/default/forms/training/admin_welcome.xlsx
  - config/default/forms/training/admin_welcome.properties.json
concepts:
  - training cards
  - form loading
  - requiresContact gate
  - first-time setup onboarding
  - Enketo forms
related_issues:
  - cht-core-8147
stale: false
---

## Problem

Two issues: (1) When logging in for the first time as the admin `medic` user on a clean CHT install, there is no data (messages, tasks, reports, contacts) and no guidance, which is confusing for implementers. (2) Enketo forms — including training cards — require the logged-in user to have an associated contact; when the contact is missing (as for the admin user), the training card modal only shows 'Error loading form' and the form cannot be loaded.

## Root Cause

Form-loading logic in `webapp/src/ts/services/form.service.ts` treated forms as requiring an associated contact without exempting training forms. A user without a contact (e.g., the admin medic user) therefore failed the contact-requirement check and could not open training cards.

## Solution

Added a new `admin_welcome` training card (XLSForm/XML/properties plus media images) that instructs first-time admins on how to populate CHT with data, and updated `form.service.ts` so `requiresContact` returns false for training forms, allowing training cards to load even when the user has no associated contact.

## Code Patterns

Exempting a form type from the contact-requirement gate: the `requiresContact` check in `webapp/src/ts/services/form.service.ts` now special-cases training forms to return false rather than uniformly requiring a contact for all forms.

## Design Choices

Instead of hiding training cards or blocking contactless users, training forms are made exempt from the contact requirement so they always load. The onboarding guidance is delivered as a standard training-card form, reusing existing training-card infrastructure rather than building a bespoke admin UI component.

## Related Files

- config/default/forms/training/admin_welcome-media/images/household-profile.png
- config/default/forms/training/admin_welcome-media/images/icon-people-pregnant-clinic.png
- config/default/forms/training/admin_welcome-media/images/logo.png
- config/default/forms/training/admin_welcome.properties.json
- config/default/forms/training/admin_welcome.xlsx
- config/default/forms/training/admin_welcome.xml
- webapp/src/ts/services/form.service.ts
- webapp/tests/karma/ts/services/form.service.spec.ts

## Testing

Added unit tests in `webapp/tests/karma/ts/services/form.service.spec.ts` (Karma), including one asserting that `requiresContact` returns false for training forms.

## Related Issues

- #10208: First-time admin on a clean CHT install sees no data and no guidance on how to get started
- #8147: Training card / Enketo form fails to load with 'Error loading form' when the logged-in user has no associated contact

## Domain Rationale

**Fit:** strong

The PR's substantive engineering change is form-loading behavior in `form.service.ts` (making `requiresContact` return false for training forms), plus a new training-card form definition. Training cards are forms and the bug is about whether a form can load, which squarely fits forms-and-reports rather than the configuration bucket.

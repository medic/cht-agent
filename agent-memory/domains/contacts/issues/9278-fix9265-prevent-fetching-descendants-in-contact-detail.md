---
id: cht-core-9265
category: bug
domain: contacts
domainFit: strong
issueNumber: 9265
issueUrl: https://github.com/medic/cht-core/issues/9265
title: Prevent contact detail from fetching descendants when user has a single assigned facility, fixing empty facility ID on app reload
lastUpdated: '2026-06-23'
summary: On app reload the contact detail view received an empty facility ID (normally populated by the contact list) and wrongly fetched descendants. The fix subscribes to the facility ID in the contacts effect constructor so it is ready early, and hides descendants when the user has exactly one assigned facility.
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
  - rxjs
tags:
  - contact-hierarchy
  - descendants
  - facility-id
  - ngrx-effects
  - contact-detail
  - store-initialization
related_workflows: []
source_pr: medic/cht-core#9278
source_sha: 5274b92dc25d54680427af8ad55ae7024485113e
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/effects/contacts.effects.ts
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
  - webapp/src/ts/modules/contacts/contacts.component.ts
concepts:
  - NgRx store/effects
  - store initialization ordering
  - contact hierarchy navigation
  - descendant loading
  - selector subscription in effect constructor
related_issues: []
stale: false
---

## Problem

When reloading the app and landing on the contact detail view, the contact detail received an empty facility ID because the contact list (which normally saves it to the store) had not run. With an empty facility ID it incorrectly fetched and displayed descendants. Additionally, descendants were shown even when the user had only one assigned facility.

## Root Cause

The user's facility ID is written to the NgRx store by the contacts list component, but the contact detail component depends on that value to decide whether to load descendants. On reload the detail view can render before the list populates the store, so the facility ID is empty and the descendant-fetch path is triggered. There was a race/initialization-ordering dependency between the list populating the store and the detail reading it.

## Solution

Subscribe to the facility ID inside the contacts effect constructor so the value is populated early in the app lifecycle, independent of which contacts route loads first. The contact detail now suppresses descendants when the user has exactly one assigned facility, but still shows them when the user has no descendants or more than one facility (since with multiple facilities the contact list does not load descendants, making the detail view the only way to navigate down the hierarchy). Also renamed several variables holding collections to plural forms.

## Code Patterns

Subscribe to store selectors in an NgRx effect's constructor (webapp/src/ts/effects/contacts.effects.ts) to guarantee derived state (the facility ID) is loaded before any component that depends on it renders, rather than relying on a sibling component having already run.

## Design Choices

Moving the facility-ID subscription into the effect constructor decouples the detail view from load order so the value is ready on reload. Gating descendant display on the count of assigned facilities (hide for exactly 1, show for 0 or >1) preserves hierarchy navigation in the multi-facility case where the list intentionally does not load descendants.

## Related Files

- webapp/src/ts/effects/contacts.effects.ts
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/ts/modules/contacts/contacts.component.ts
- webapp/tests/karma/ts/modules/contacts/contacts-content.component.spec.ts
- webapp/tests/karma/ts/modules/contacts/contacts.component.spec.ts

## Testing

Updated Karma unit tests in contacts-content.component.spec.ts and contacts.component.spec.ts to cover the descendant-display logic and facility-ID handling. Manually verified via screen recordings attached to the PR.

## Related Issues

- #9265: Contact detail incorrectly fetches/displays descendants (empty facility ID on app reload)

## Domain Rationale

**Fit:** strong

The change governs how the contact detail view loads and displays descendants within the contact hierarchy, and touches the contacts components/effects directly. The 'facility ID' here is the user's position in the contact place hierarchy, not an auth/permission concern.

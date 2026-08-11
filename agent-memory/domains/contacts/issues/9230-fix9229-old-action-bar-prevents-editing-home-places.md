---
id: cht-core-9229
category: bug
domain: contacts
domainFit: strong
issueNumber: 9229
issueUrl: https://github.com/medic/cht-core/issues/9229
title: Old action bar wrongly enabled the Edit button for a user's home place after facility_id became an array
lastUpdated: '2026-08-11'
summary: After `facility_id` became an array, the old action bar's `canEdit` check (`facility_id !== doc._id`) was always true, so users with assigned facilities could still edit their home place. The fix switches the check to `!facility_id?.includes(doc._id)` so the Edit icon is correctly disabled for offline users viewing an assigned facility.
services:
  - webapp
techStack:
  - typescript
  - angular
tags:
  - action-bar
  - home-place
  - contact-editing
  - ui
  - multi-facility
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9230
source_sha: 9f900220a34754b1eb62a73e6ccbf6b4a3d30c14
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
concepts:
  - deprecated action bar UI component
  - home place / user facility
  - contact edit action gating
  - Angular component state
related_issues: []
stale: true
---

## Problem

With the old action bar enabled, a user assigned to one or more facilities could still click Edit on their own home place. The Edit icon is meant to be disabled for that case, but the gating expression compared `userSettings.facility_id` to the selected contact's `_id` with `!==`. Once multi-facility support (4.9.0) made `facility_id` an array, that comparison was always true, so the edit affordance stayed enabled when it should have been disabled.

## Root Cause

`ContactsContentComponent.setRightActionBar()` set `canEdit: this.isOnlineOnly || this.userSettings?.facility_id !== this.selectedContact?.doc?._id`. The strict `!==` only worked while `facility_id` was a plain string; against an array (`['x'] !== 'x'`) it never matched, so the home-place case never suppressed the edit action. The action bar template disables the icon with `[ngClass]="{'mm-icon-disabled': !actionBar?.right?.canEdit}"`, so a permanently-true `canEdit` left the button live.

## Solution

Changed the one gating expression in contacts-content.component.ts to a membership test: `canEdit: this.isOnlineOnly || !this.userSettings?.facility_id?.includes(this.selectedContact?.doc?._id)`. Offline users viewing a place that is in their assigned `facility_id` list now get a disabled Edit icon again; online-only users are unaffected because `isOnlineOnly` short-circuits.

## Code Patterns

When a scalar user setting is widened to an array (here `facility_id`, widened by the 4.9.0 multi-facility work), audit every `===`/`!==` comparison against it — a strict comparison silently flips to always-true and quietly removes a guard rather than throwing. Prefer `Array.isArray(...)`/`.includes(...)` membership tests. (As of 4.9.x; the old action bar, `setRightActionBar` and `canEdit` were removed from webapp/src/ts/modules/contacts/contacts-content.component.ts by #9361.)

## Design Choices

Fixed the comparison in place rather than normalizing `facility_id` at the component boundary, matching the point-of-consumption approach used elsewhere for the same widening (#9204). `.includes()` also keeps working for legacy string `facility_id` values, so no separate string branch was needed.

## Related Files

- webapp/src/ts/modules/contacts/contacts-content.component.ts

## Testing

The PR added no tests; it is a one-line change in webapp/src/ts/modules/contacts/contacts-content.component.ts.

## Related Issues

- #9229: Old action bar should prevent users with multiple facilities assigned from editing the homeplace

## Domain Rationale

**Fit:** strong

The fix is in the contacts module (contacts-content.component.ts) and corrects whether the edit action is offered for a user's home place — a place/contact in the hierarchy — which is squarely contact/place management, not configuration.

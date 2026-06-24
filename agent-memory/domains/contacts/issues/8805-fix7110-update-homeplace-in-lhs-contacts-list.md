---
id: cht-core-7110
category: bug
domain: contacts
domainFit: strong
issueNumber: 7110
issueUrl: https://github.com/medic/cht-core/issues/7110
title: Fix LHS contacts list not updating user home place after sync for offline users
lastUpdated: '2026-06-23'
summary: For offline users, the home place shown in the left-hand-side contacts list stayed stale after syncing an edit to that home place, even though the detail view reflected the change. Fixed the contacts component to re-resolve and update userHomePlace when the relevant doc changes on sync.
services:
  - webapp
techStack:
  - typescript
  - angular
  - rxjs
  - webdriverio
  - karma
tags:
  - contacts-list
  - home-place
  - offline-user
  - ui-refresh
  - changes-feed
  - stale-state
  - bug-fix
related_workflows: []
source_pr: medic/cht-core#8805
source_sha: dac993b4529cd70fea76cf9678f0c2e02705e7e5
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts.component.ts
concepts:
  - contacts list view
  - Changes feed subscription
  - offline-first view refresh
  - view-model state synchronization
related_issues: []
stale: false
---

## Problem

For offline users, when an admin edited the offline user's home place in another session and the offline user then synced, the home place displayed in the left-hand-side (LHS) contacts list did not update. The right-hand-side detail view reflected the synced change, but the LHS list/home-place entry remained stale.

## Root Cause

The contacts list component (contacts.component.ts) did not re-resolve its userHomePlace reference when the corresponding contact document arrived via the Changes feed on sync; the home-place value was effectively resolved once and not refreshed when relevant changes came through, so the LHS list rendered outdated data.

## Solution

Updated contacts.component.ts to refresh/re-resolve userHomePlace when the relevant document changes on sync, extracting the home-place resolution logic into dedicated functions (per reviewer feedback) so the LHS list stays consistent with synced data. Added karma unit coverage and a new wdio e2e spec to guard the regression.

## Code Patterns

Extract home-place resolution into reusable functions in webapp/src/ts/modules/contacts/contacts.component.ts and re-invoke them on Changes-feed/sync events, keeping the contacts list view-model reactive to local DB changes rather than resolving derived state only on initial load.

## Design Choices

Refresh the displayed home place reactively on change events instead of only at load time so the LHS list mirrors synced data; the resolution logic was factored into discrete functions to make the behavior unit-testable, addressing reviewers' explicit request for coverage.

## Related Files

- webapp/src/ts/modules/contacts/contacts.component.ts
- webapp/tests/karma/ts/modules/contacts/contacts.component.spec.ts
- tests/e2e/default/contacts/edit-person-home-place.wdio-spec.js
- tests/e2e/default/contacts/add-new-district.wdio-spec.js
- tests/page-objects/default/contacts/contacts.wdio.page.js

## Testing

Added a new e2e wdio spec (edit-person-home-place.wdio-spec.js) plus updates to add-new-district.wdio-spec.js and the contacts page object, and added karma unit coverage in contacts.component.spec.ts to reproduce and guard the stale-home-place bug; reviewers explicitly requested both unit and e2e coverage.

## Related Issues

- #7110: For offline users, the LHS contacts list does not update the home place after syncing an edit to it

## Domain Rationale

**Fit:** strong

The entire change lives in the contacts list component (contacts.component.ts) and its contacts tests, fixing how the offline user's home place is displayed/refreshed in the LHS contacts list. Although the bug surfaces 'on sync,' replication itself works (the RHS detail view updates) and no sync/replication code is touched — the root cause is contacts-list view-state refresh, so it is not a data-sync issue.

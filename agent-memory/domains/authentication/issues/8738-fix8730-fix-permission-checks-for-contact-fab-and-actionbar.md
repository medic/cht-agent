---
id: cht-core-8730
category: bug
domain: authentication
domainFit: strong
issueNumber: 8730
issueUrl: https://github.com/medic/cht-core/issues/8730
title: Fix contact FAB and actionbar permission checks to honour can_create_people
lastUpdated: '2026-10-05'
summary: The contacts FAB and the old actionbar's contacts-list create menu gated contact creation only on `can_create_places`, so a user with `can_create_people` but not `can_create_places` could not create people from the contact-detail FAB, and the old actionbar's contacts-list create container (place types only, Export link included) was hidden from them. The fix makes the FAB require `can_create_people` for person contact types and `can_create_places` for place types, and lets the old actionbar's contacts-list create links show for either permission.
services:
  - webapp
techStack:
  - typescript
  - angular
  - html
  - webdriverio
  - karma
tags:
  - permissions
  - can_create_people
  - can_create_places
  - authorization
  - fab
  - actionbar
  - contacts
  - ui-gating
related_workflows:
  - contact-creation
source_pr: medic/cht-core#8738
source_sha: 91c9349205324af36106749fe6d60042dbceb8f0
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/fast-action-button.service.ts
  - webapp/src/ts/components/actionbar/actionbar.component.html
concepts:
  - permission-based UI gating
  - authorization
  - fast action button
  - actionbar
  - role-based access control
related_issues:
  - cht-core-8181
stale: true
---

## Problem

In the contacts FAB, `FastActionButtonService.getContactFormActions()` gated every child contact type on `can_create_places` (together with `can_edit`), whether the type was a person or a place. Only the contact-detail FAB lists person types (webapp/src/ts/modules/contacts/contacts-content.component.ts feeds it `getChildren(selectedContact.type.id)` unfiltered), so a user granted `can_create_people` but not `can_create_places` lost the create-person actions there: the issue reports users unable to enroll patients after upgrading to 4.4.1, with granting `can_create_places` as the workaround. The contacts-list (left) pane of the old actionbar, which at this PR non-admin users with `can_view_old_action_bar` saw (the old actionbar and that permission were removed on master by PR #9361), listed place types only (`getChildren()` in webapp/src/ts/modules/contacts/contacts.component.ts drops `person` types); its create links required `can_edit` and `can_create_places`, and the container that holds them and the Export link required `can_create_places`, so users without that permission also lost the Export link. Conversely, a user with `can_create_places` but not `can_create_people` was offered person creation in the FAB. The old actionbar's contact-detail (right-pane) create actions were not affected; they already took a per-type `can_create_people`/`can_create_places` permission from webapp/src/ts/modules/contacts/contacts-content.component.ts.

## Root Cause

In `FastActionButtonService.getContactFormActions()` (`webapp/src/ts/services/fast-action-button.service.ts`), each child contact type's `canDisplay` called `this.authService.has(['can_edit', 'can_create_places'])`, with no branch on the contact type. In the old actionbar's contacts-tab left pane (`webapp/src/ts/components/actionbar/actionbar.component.html`), the create container was gated by `[mmAuthAny]="[ actionBar?.left?.childPlaces && 'can_create_places' ]"` and each create link or menu by `mmAuth="can_edit,can_create_places"`; the template did not mention `can_create_people` at all. That pane listed place types only (`getChildren()` in webapp/src/ts/modules/contacts/contacts.component.ts filters out `person` types), so this gating hid no person action; it hid the whole container, Export link included, from users without `can_create_places`.

## Solution

The PR corrected the existing checks rather than adding new ones.

- FAB: `canDisplay` now requires `can_edit` plus `contactType.person ? 'can_create_people' : 'can_create_places'`, so each child contact type is gated by the permission for its kind. `getContactFormActions()` feeds both `getContactLeftSideActions()` and `getContactRightSideActions()`.
- Actionbar: each create link or menu changed from `mmAuth="can_edit,can_create_places"` to `mmAuth="can_edit" [mmAuthAny]="['can_create_places', 'can_create_people']"`, so either permission is enough; this template does not split the check per contact type. The container, which also holds the Export link, changed to `[mmAuthAny]="[ 'can_export_all', 'can_export_contacts', 'can_create_places', 'can_create_people' ]"`.

The same diff also changed the FAB label fallbacks from `||` to `??` and the send-message callback to `callbackOpenSendMessage?.(...)`.

## Code Patterns

Choose the permission from the contact type: in a FastAction's `canDisplay`, call `this.authService.has(['can_edit', contactType.person ? 'can_create_people' : 'can_create_places'])`. In templates, `mmAuth` takes a comma-separated list that must all be held, and `[mmAuthAny]` takes a list of which at least one must be held; on the same element both must pass.

## Design Choices

`can_edit` stays a hard requirement for every create action; only the second permission varies. The FAB checks per contact type. The old actionbar's create links only widened the gate to accept either permission.

## Related Files

- webapp/src/ts/services/fast-action-button.service.ts
- webapp/src/ts/components/actionbar/actionbar.component.html (present at this PR's anchor; removed on master by PR #9361, "remove old action bar, search and filters")
- webapp/tests/karma/ts/services/fast-action-button.service.spec.ts
- tests/e2e/default/contacts/fab-actionbar.wdio-spec.js (added; removed on master by PR #9361)
- tests/page-objects/default/common/common.wdio.page.js

## Testing

The Karma spec `webapp/tests/karma/ts/services/fast-action-button.service.spec.ts` adds a `person: true` child contact type to the `getContactRightSideActions()` cases and asserts that `authService.has` is called with `['can_edit', 'can_create_people']` for it, next to the existing `['can_edit', 'can_create_places']` calls for place types. The new e2e spec `tests/e2e/default/contacts/fab-actionbar.wdio-spec.js` checks that the FAB offers "New household" and "New person" under the default permissions, only the household form when `can_create_people` is removed, and only the person form when `can_create_places` is removed. It also checks the old action bar's contact-detail (right-pane) labels, with `can_view_old_action_bar` granted, under the same permission removals. The page object `tests/page-objects/default/common/common.wdio.page.js` gained `getFastActionItemsLabels()` and `getActionBarLabels()`. On master the e2e spec and `getActionBarLabels()` are gone, both removed by PR #9361; `getFastActionItemsLabels()` remains.

## Related Issues

- #8730: "Actionbar does not include links to create people when users have only the can_create_people permission" (this draft's issue)
- #8181: "Remove old design that was replaced by Material design" — its PR #9361 later deleted the old actionbar template and this PR's e2e spec; the FAB check survives on master

## Domain Rationale

**Fit:** strong

Apart from two small changes in the FAB service (the label fallbacks and an optional call), every source change in the diff is to a permission predicate: the arguments to `authService.has()` in `canDisplay`, and the `mmAuth`/`mmAuthAny` attributes in the actionbar template. The bug was a wrong mapping from action to permission. In the FAB the fix makes `can_create_people` and `can_create_places` each gate the create actions they name; in the old actionbar it widens the create links to accept either. The contacts page is only where these checks are shown; no contact-creation logic, form, or data handling changed.

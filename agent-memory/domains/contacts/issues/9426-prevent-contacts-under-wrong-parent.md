---
id: cht-core-9426
category: bug
domain: contacts
subDomain: hierarchy-validation
issueNumber: 9426
issueUrl: https://github.com/medic/cht-core/issues/9426
title: Prevent creating contacts under non-direct parent type
lastUpdated: 2026-03-16
summary: Fixed a validation gap where contacts could be created under any parent by manipulating the URL, bypassing the configured hierarchy. Added parent type validation in the ContactsEditComponent.
services:
  - webapp
techStack:
  - typescript
  - angular
---

## Problem

A contact could be created under a parent that is not its valid direct parent type by manually constructing a URL (e.g., `#/contacts/[district-hospital-id]/add/clinic`). This allowed creating a clinic directly under a district hospital, violating the configured hierarchy. A real-world case resulted in "bizarre recursive place" bugs.

## Root Cause

The `ContactsEditComponent.getForm()` method, when handling contact creation, assembled the new contact object and fetched its form ID but never validated whether the parent (from `parent_id` URL param) is a valid direct parent type for the contact type being created. The hierarchy defined in `app_settings.json` was entirely ignored during this path.

## Solution

PR #9563 added a `validateParentForCreateForm()` method to `ContactsEditComponent` that runs before the form is rendered. It has two branches:
1. **No parent (top-level creation):** Calls `contactTypesService.getChildren()` with no argument to get valid top-level types. If the contact type is not in that list, throws an error.
2. **Parent present:** Fetches the parent document from PouchDB, resolves its type via `contactTypesService.getTypeId()`, then calls `getChildren(parentType)` to get valid direct children. If the contact type is not in that list, throws an error setting `contentError = true` and preventing form rendering.

## Code Patterns

- Hierarchy validation uses `contactTypesService.getChildren(parentTypeId?)` which returns valid child types for a given parent type
- Type resolution from a contact document uses `contactTypesService.getTypeId(doc)` which handles both legacy and new-style contact type fields
- Validation runs before form rendering — if invalid, `contentError = true` prevents any user interaction
- File: `webapp/src/ts/modules/contacts/contacts-edit.component.ts` — `validateParentForCreateForm()` method
- Pattern: Always validate URL parameters against the configured hierarchy before rendering contact creation forms

## Design Choices

- Validation is client-side in the Angular component rather than server-side, because the form rendering decision is a UI concern
- Uses existing `contactTypesService` APIs rather than reimplementing hierarchy traversal
- Fails closed — an invalid parent prevents form rendering entirely rather than showing a warning
- Only applies to creation, not editing (editing a contact doesn't change its parent relationship)

> **Note:** This fix is client-side only. Neither `validate_doc_update.js` (medic nor medic-client) enforces parent-child hierarchy rules. A direct CouchDB write with an invalid parent would still succeed. Server-side hierarchy validation does not exist as of this fix.

## Related Files

- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/src/ts/services/contact-types.service.ts

## Testing

- Unit test verifying that creating a contact under an invalid parent type sets `contentError = true` and never calls `formService.render`
- Updated existing tests to provide `parent_id` in route params and stub the parent document lookup

## Related Issues

- #6363: Related discussion on contact hierarchy integrity

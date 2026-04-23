---
id: cht-core-9264
category: bug
domain: contacts
subDomain: telemetry
issueNumber: 9264
issueUrl: https://github.com/medic/cht-core/issues/9264
title: Contact detail telemetry not recording contact type in default config
lastUpdated: 2026-03-16
summary: Fixed telemetry recording the generic string "contact" instead of the actual contact type (e.g., "person", "clinic") on the contact detail page, caused by not handling legacy hardcoded contact types.
services:
  - webapp
techStack:
  - typescript
  - angular
---

## Problem

When viewing a contact detail page in the default config, telemetry recorded the generic string `contact` instead of the actual contact type name. For example, `contact_detail:contact:load` was recorded instead of `contact_detail:clinic:load`. This only affected the default config — partner configs with new-style contact types worked correctly.

## Root Cause

In `contacts.effects.ts`, the code read the contact type directly from `contact?.doc?.contact_type`. This works for new-style contacts where `doc.type === 'contact'` and the actual type is in `doc.contact_type`. However, the default config uses legacy hardcoded types (`person`, `clinic`, `district_hospital`, `health_center`) where the type is stored in `doc.type` (not `doc.contact_type`). For these documents, `doc.contact_type` is `undefined`, so the telemetry key fell back to the literal string `"contact"`.

## Solution

PR #9276 replaced the direct field access with a call to `contactTypesService.getTypeId(contact?.doc)`, which delegates to `contactTypesUtils.getTypeId()` from the shared lib. This utility correctly handles both schemas:
- Legacy: `doc.type !== 'contact'` -> returns `doc.type` (e.g., `"person"`)
- New-style: `doc.type === 'contact'` -> returns `doc.contact_type` (e.g., `"hospital"`)

## Code Patterns

- CHT has two contact type schemas: legacy (`doc.type` = actual type) and new-style (`doc.type` = `"contact"`, `doc.contact_type` = actual type)
- Always use `contactTypesService.getTypeId(doc)` or `contactTypesUtils.getTypeId(doc)` to resolve contact type — never read `doc.contact_type` directly
- File: `webapp/src/ts/effects/contacts.effects.ts` — changed from `contact?.doc?.contact_type` to `this.contactTypesService.getTypeId(contact?.doc)`
- File: `shared-libs/contact-types-utils/src/index.js` — `getTypeId()` handles both schemas

## Design Choices

- Used the existing shared utility (`getTypeId`) rather than adding inline logic, ensuring consistency across the codebase
- Injected `ContactTypesService` as a dependency rather than importing the shared lib directly, following the Angular dependency injection pattern

## Related Files

- webapp/src/ts/effects/contacts.effects.ts
- shared-libs/contact-types-utils/src/index.js

## Testing

- Updated unit tests to include both legacy and new-style contact documents
- Verified telemetry keys contain actual type names (`person`, `hospital`) instead of generic `contact`

## Related Issues

- None directly referenced

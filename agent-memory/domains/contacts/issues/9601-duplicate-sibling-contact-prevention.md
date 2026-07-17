---
id: cht-core-9601
category: feature
domain: contacts
subDomain: deduplication
issueNumber: 9601
issueUrl: https://github.com/medic/cht-core/issues/9601
title: Prevent duplicate sibling contact capture
source_prs:
  - "medic/cht-core#9609"
lastUpdated: 2026-07-16
summary: Added configurable duplicate detection during contact creation that compares the new contact against existing siblings using Levenshtein distance, surfacing potential matches to the CHW before saving.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
---

## Problem

Community Health Workers frequently created duplicate contacts because they forgot about previous records or slightly mistyped names. Despite improved search functionality and training, usage of the pre-creation search feature remained low. Duplicate records corrupted task lists and degraded data quality at all user-created hierarchy levels.

## Root Cause

CouchDB has no native constraint enforcement for contact uniqueness within a parent. The app had no post-form-fill, pre-save check against existing siblings. The only mitigation was training CHWs to search before creating, which had low adoption.

## Solution

PR #9609 intercepts the `saveContact` flow and injects a duplicate detection step before writing to CouchDB. A new `DeduplicateService` compares the contact being saved against all siblings of the same type using a configurable expression (default: Levenshtein distance <= 3 on name AND matching age). If duplicates are found, the save is blocked and candidates are displayed in an expandable panel. The CHW must explicitly acknowledge via a checkbox before the save proceeds.

The check runs on both the create and edit flows, surfacing matches as expandable/collapsible cards in a new `duplicate_info` section injected into `enketo.component.html` (PR #9609). Conditional checking is supported via an `is_canonical` question, and the feature can be disabled per form with `duplicate_check.disabled`; when no expression is supplied the check defaults to comparing the `name` field. Includes i18n strings across all supported locales (PR #9609).

## Code Patterns

- Duplicate detection uses a configurable expression engine evaluated via `ParseProvider`, allowing per-form customization
- Default expression: `levenshteinEq(current.name, existing.name, 3) && ageInYears(current) === ageInYears(existing)`
- Custom expressions are set in the form document's `context.duplicate_check.expression` field
- Expressions can match arbitrary field combinations (e.g. name, sex, DOB, street/postal), not just name (PR #9609)
- File: `webapp/src/ts/services/deduplicate.service.ts` — core detection logic, filters siblings using parsed expression
- File: `webapp/src/ts/services/xml-forms-context-utils.service.ts` — provides `levenshteinEq()` and `normalizedLevenshteinEq()` utility functions
- File: `webapp/src/ts/services/contacts.service.ts` — `getSiblings()` queries `medic-client/contacts_by_parent` view
- File: `webapp/src/ts/services/form.service.ts` — `checkForDuplicates()` gates `saveContact`, throws `DuplicatesFoundError` if matches found
- File: `webapp/src/ts/components/duplicate-contacts/duplicate-contacts.component.ts` — renders duplicate candidates in `mat-expansion-panel`
- File: `webapp/src/ts/modules/contacts/contacts-edit.component.ts` — handles `DuplicatesFoundError`, manages acknowledgment state

## Design Choices

- Used Levenshtein distance rather than exact match to catch common misspellings and transliterations
- Expression is configurable per form via `context.duplicate_check` JSON — allows disabling (`disabled: true`) or custom matching logic
- Siblings are fetched from the `contacts_by_parent` CouchDB view rather than a new index, reusing existing infrastructure
- Duplicates are shown in expandable panels with lazy-loaded contact summaries to avoid upfront performance cost
- The detection is opt-out (enabled by default) rather than opt-in, to maximize data quality across deployments
- Telemetry tracks both `duplicates_found` and `duplicates_acknowledged` events for monitoring effectiveness
- Shipped intentionally as a "prototype" with the supported strategy set limited to Levenshtein-based matching, leaving room for future expansion (PR #9609)
- The `is_canonical` question enables downstream conditional handling (merge or delete) of the flagged duplicates (PR #9609)

## Related Files

- webapp/src/ts/services/deduplicate.service.ts
- webapp/src/ts/services/xml-forms-context-utils.service.ts
- webapp/src/ts/services/contacts.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/components/duplicate-contacts/duplicate-contacts.component.ts
- webapp/src/ts/components/duplicate-contacts/duplicate-contacts.component.html
- webapp/src/ts/components/enketo/enketo.component.html
- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/src/ts/modules/contacts/contacts-edit.component.html
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/ts/components/contact-summary-content/contact-summary-content.component.ts
- tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js
- api/resources/translations/messages-en.properties

## Testing

- Unit tests for `DeduplicateService` covering expression parsing and sibling filtering
- Unit tests for `DuplicateContactsComponent` covering expansion panel and lazy summary loading
- Extended unit tests for `ContactsService.getSiblings()`, `FormService.saveContact()`, and `ContactsEditComponent`
- Unit tests for new Levenshtein utility functions in `XmlFormsContextUtilsService`
- E2E tests creating contacts with similar names and verifying duplicate detection UI
- Dedicated e2e spec at `tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js`, plus updates to related contacts/targets/telemetry/transitions specs and the contacts and generic-form page objects (PR #9609)

## Related Issues

- #6363: Prior discussion on mitigating duplicate data capture

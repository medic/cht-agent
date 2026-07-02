---
id: cht-core-9601
category: feature
domain: contacts
domainFit: strong
issueNumber: 9601
issueUrl: https://github.com/medic/cht-core/issues/9601
title: 'Add configurable duplicate-contact prevention: Levenshtein sibling matching with in-form duplicate cards and acknowledgement gate'
lastUpdated: '2026-06-22'
summary: Contacts could be created with names nearly identical to existing siblings with no built-in deterrent against duplicates. This PR adds a configurable duplicate-detection feature that compares the contact being created/edited against its siblings (via the contacts_by_parent view) using Levenshtein-based expressions, surfaces potential duplicates as expandable cards in the form, and requires CHW acknowledgement before submission.
services:
  - webapp
  - api
techStack:
  - typescript
  - angular
  - couchdb
  - enketo
  - less
tags:
  - duplicate-detection
  - deduplication
  - contacts
  - levenshtein
  - fuzzy-matching
  - contact-creation
  - form-submission
  - configuration
related_workflows:
  - contact-creation
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#9609
source_sha: b965953914d786826ed6160812cc7797d67ae4a9
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/deduplicate.service.ts
  - webapp/src/ts/services/form.service.ts
  - webapp/src/ts/components/duplicate-contacts/duplicate-contacts.component.ts
  - webapp/src/ts/services/contacts.service.ts
  - webapp/src/ts/services/xml-forms-context-utils.service.ts
  - webapp/src/ts/components/enketo/enketo.component.html
  - webapp/src/ts/modules/contacts/contacts-edit.component.ts
concepts:
  - configuration-driven duplicate detection
  - fuzzy string matching (Levenshtein distance)
  - sibling lookup via CouchDB views
  - form submission gating with explicit acknowledgement
  - contact deduplication lifecycle (merge/delete via is_canonical)
related_issues: []
stale: false
---

## Problem

There was no built-in deterrent against creating contact records (places or persons) with names similar to existing siblings in the hierarchy. CHWs could unknowingly create duplicate places/persons, degrading data quality, with no surfacing of likely matches during the create or edit flow.

## Root Cause

The contact create/edit save path (saveContact in form.service.ts) persisted records without any comparison against existing sibling contacts. Duplicate prevention was simply a missing capability — no service evaluated similarity and no UI surfaced potential matches before submission.

## Solution

Introduced a configuration-driven duplicate-detection mechanism. A new deduplicate.service.ts evaluates duplicate-check expressions (levenshteinEq, normalizedLevenshteinEq) against siblings loaded from the medic-client/contacts_by_parent view, with `current` (the form being saved) and `existing` (a sibling) in scope. saveContact in form.service.ts was extended to run this check; matches are rendered as expandable/collapsible cards in a new duplicate_info section in enketo.component.html via the duplicate-contacts component, with an acknowledgement prompt that must be satisfied before submission. Configuration supports per-form custom expressions, a default name comparison when none is supplied, conditional checking via the is_canonical question, and an opt-out via duplicate_check.disabled. Includes i18n strings across all supported locales.

## Code Patterns

Forms declare a `duplicate_check.expression` (e.g. `levenshteinEq(3, current.name, existing.name)`) in their context config; deduplicate.service.ts evaluates it per sibling with `current`/`existing` bound, and Levenshtein helpers are exposed through xml-forms-context-utils.service.ts. Sibling enumeration reuses the existing medic-client/contacts_by_parent CouchDB view rather than a new index. Expressions can match arbitrary fields (name, sex, DOB, street/postal). Opt-out via `duplicate_check.disabled: true`; absent an expression the check defaults to the `name` field.

## Design Choices

Reuses the existing contacts_by_parent view instead of adding a new index. Duplicate logic is configuration-driven (expression strings) rather than hardcoded, so implementers can match on any field combination. Rather than hard-blocking submission, the design surfaces likely duplicates and requires explicit CHW acknowledgement, balancing data quality against field realities (legitimate same-name records). The is_canonical question enables downstream conditional handling (merge or delete). Shipped intentionally as a 'prototype' with the supported strategy set limited to Levenshtein-based matching, leaving room for expansion.

## Related Files

- webapp/src/ts/services/deduplicate.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/contacts.service.ts
- webapp/src/ts/services/xml-forms-context-utils.service.ts
- webapp/src/ts/components/duplicate-contacts/duplicate-contacts.component.ts
- webapp/src/ts/components/duplicate-contacts/duplicate-contacts.component.html
- webapp/src/ts/components/enketo/enketo.component.html
- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/ts/components/contact-summary-content/contact-summary-content.component.ts
- tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js
- api/resources/translations/messages-en.properties

## Testing

Added Karma unit tests for deduplicate.service, form.service, contacts.service, xml-forms-context-utils.service, the duplicate-contacts component, and the contacts-edit component. Added a dedicated e2e spec (tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js) and updated related contacts/targets/telemetry/transitions specs and the contacts and generic-form page objects. The reviewer (jkuester) specifically called out the quality of the unit tests.

## Related Issues

- #9601: Feature request to prevent duplicate place/person creation and display possible duplicate siblings for consideration
- #6363: Earlier discussion on the duplicate-contacts topic, referenced for additional input

## Domain Rationale

**Fit:** strong

The PR's core purpose is preventing duplicate contact siblings (places/persons) during the contact create/edit lifecycle — squarely contact management. It touches Enketo forms and configurable expressions, but those are the mechanism; the feature itself is contact deduplication, and the bulk of changed files live under webapp contacts components/services plus a dedicated duplicate-contacts e2e spec.

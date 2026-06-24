---
id: cht-core-9203
category: bug
domain: authentication
domainFit: strong
issueNumber: 9203
issueUrl: https://github.com/medic/cht-core/issues/9203
title: Add facility_id backward compatibility in admin app edit-user form (cast legacy string facility_id to array)
lastUpdated: '2026-06-23'
summary: Existing offline users whose facility_id was stored as a legacy string could not be loaded in the admin app's edit-user form, which expects an array. The fix type-casts string facility_id values to a single-element array on load so these users can be edited.
services:
  - admin
  - webapp
techStack:
  - javascript
  - typescript
  - angularjs
  - angular
  - couchdb
tags:
  - facility_id
  - backward-compatibility
  - user-management
  - admin-app
  - type-casting
  - multi-facility
  - validate_doc_update
related_workflows:
  - user-registration
  - data-migration
source_pr: medic/cht-core#9204
source_sha: 7bcb37581af79758e80a097de5af512b78a9524f
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/edit-user.js
  - ddocs/medic-db/medic/validate_doc_update.js
  - ddocs/medic-db/medic-client/validate_doc_update.js
  - webapp/src/ts/modules/contacts/contacts-more-menu.component.ts
concepts:
  - backward compatibility shim
  - data model evolution (string to array)
  - type coercion / typecasting
  - user-facility association
  - multi-facility support
  - document validation (validate_doc_update)
  - API typecasting vs direct CouchDB access
related_issues: []
stale: false
---

## Problem

For existing offline users whose facility_id was stored as a single string (the legacy pre-multi-facility format), the admin app's edit-user form could not load them because the facility multiselect expects an array. Since the admin app fetches the facility list directly from CouchDB instead of through the API, it bypasses the API's typecasting of string facility_id to array, so these users' raw string values reached the form un-converted and broke editing.

## Root Cause

Multi-facility support changed facility_id from a string to an array. The API converts legacy string values to arrays when serving user data, but the admin app's facility multiselect queries CouchDB directly, bypassing that API-side typecast. Legacy users therefore arrived at the array-expecting edit form with an un-cast string facility_id, which it could not handle.

## Solution

Added backward-compatibility type casting in the admin edit-user controller so a string facility_id is coerced to a single-element array before populating the edit form. Supporting changes updated the medic and medic-client validate_doc_update.js design docs related to the array-shaped facility_id, adjusted the contacts more-menu component, and updated default app_settings.json. Unit tests in edit-user.spec.js cover the casting.

## Code Patterns

Defensive normalization of polymorphic document fields when bypassing the API: in admin/src/js/controllers/edit-user.js, coerce facility_id to an array on load (e.g. Array.isArray(facility_id) ? facility_id : [facility_id]) so both legacy string and current array shapes work. Reusable anywhere the admin app reads documents straight from CouchDB and must replicate the API's typecasting.

## Design Choices

Used a runtime compatibility shim (cast string to array on read) instead of a bulk data migration of all user documents, so legacy offline users keep working without a migration pass and the admin app stays correct even though it reads directly from CouchDB rather than through the typecasting API.

## Related Files

- admin/src/js/controllers/edit-user.js
- admin/tests/unit/controllers/edit-user.spec.js
- config/default/app_settings.json
- ddocs/medic-db/medic-client/validate_doc_update.js
- ddocs/medic-db/medic/validate_doc_update.js
- webapp/src/ts/modules/contacts/contacts-more-menu.component.ts

## Testing

Added/updated unit tests in admin/tests/unit/controllers/edit-user.spec.js verifying that a user with a string facility_id is cast to an array when loaded into the edit form.

## Related Issues

- #9203: Admin app edit-user form fails for offline users with a legacy string facility_id because the admin app queries CouchDB directly and bypasses the API typecast to array

## Domain Rationale

**Fit:** strong

This is user-account management in the admin app (editing a user's facility assignment), which is canonically the authentication/user-management domain in CHT — a user's facility_id governs their data-access scope (authorization). No dedicated 'users' domain exists, and roles/facilities/sessions all belong to authentication, so this is a principled home rather than a least-bad pick.

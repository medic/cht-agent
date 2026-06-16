---
id: cht-core-9203
category: bug
domain: contacts
subDomain: admin
issueNumber: 9203
issueUrl: https://github.com/medic/cht-core/issues/9203
title: Backward compatibility of facility_id in Admin app
lastUpdated: 2026-03-16
summary: Fixed the Admin app's edit-user form crashing when facility_id was stored as a legacy string instead of an array, by adding defensive normalization at the point of consumption.
services:
  - admin
  - webapp
techStack:
  - javascript
  - angular
  - couchdb
---

## Problem

In CHT v4.8.0, the Admin app introduced a multi-select facility picker that changed `facility_id` from a `string` to an `Array`. However, existing users in older databases still had a `string` value. When editing such a user in the Admin app, the `facility_id` string was passed directly as `keys` to a CouchDB `_bulk_get` query, which requires an array. CouchDB returned `{"error":"bad_request","reason":"\`keys\` body member must be an array."}`, causing the user's place to fail to load entirely.

## Root Cause

The Admin app's edit-user flow queried CouchDB directly (bypassing the API layer that normally enforces the string-to-array typecasting). When `facility_id` was a plain string from pre-migration data, it was passed unmodified to CouchDB queries expecting an array.

## Solution

PR #9204 added defensive normalization at multiple consumption points:
1. **`edit-user.js`:** New `getFacilityId()` helper wraps the value in an array if it's not already one, with fallback to `[]` if missing
2. **`validate_doc_update.js` (both medic and medic-client):** Authorization guards updated to handle both string and array forms of `facility_id` using `Array.isArray()` check
3. **`contacts-more-menu.component.ts`:** Changed direct string comparison to use the `isUserFacility` computed property that handles both data shapes
4. **`app_settings.json`:** Added `can_have_multiple_places` permission

## Code Patterns

- Always normalize `facility_id` to an array before use — never assume it's already an array
- Pattern: `if (!Array.isArray(facility_id)) { facility_id = [facility_id]; }`
- File: `admin/src/js/controllers/edit-user.js` — `getFacilityId()` normalization helper
- File: `ddocs/medic-db/medic-client/validate_doc_update.js` — dual string/array check for authorization
- File: `ddocs/medic-db/medic/validate_doc_update.js` — same dual check
- File: `webapp/src/ts/modules/contacts/contacts-more-menu.component.ts` — uses `isUserFacility` instead of direct comparison

## Design Choices

- Fixed at the point of consumption rather than running a migration to convert all existing string values, to be defensive against any edge cases
- Both CouchDB design-doc validators were updated to ensure authorization checks work regardless of data shape
- The normalization is idempotent — already-array values pass through unchanged

## Related Files

- admin/src/js/controllers/edit-user.js
- ddocs/medic-db/medic-client/validate_doc_update.js
- ddocs/medic-db/medic/validate_doc_update.js
- webapp/src/ts/modules/contacts/contacts-more-menu.component.ts
- config/default/app_settings.json

## Testing

- Unit test verifying that a user with `facility_id: 'abc'` (string) results in `editUserModel.facilitySelect` being `['abc']` (array)

## Related Issues

- None directly referenced

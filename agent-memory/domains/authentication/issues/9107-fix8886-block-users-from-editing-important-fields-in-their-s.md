---
id: cht-core-8886
category: bug
domain: authentication
domainFit: strong
issueNumber: 8886
issueUrl: https://github.com/medic/cht-core/issues/8886
title: Block non-admin users from creating user-settings docs or changing their roles via validate_doc_update
lastUpdated: '2026-09-29'
summary: Users could edit their own user-settings doc in the medic database, including the `roles` array that shadows their `_users` roles, through direct API calls or by replicating a PouchDB edit. The medic-client `validate_doc_update` now rejects, for anyone who is not a DB admin, creating a user-settings doc or changing its `roles`. The PR also fixes the medic ddoc's `isDbAdmin` check so that users made admins by role in the database security object are recognised.
services:
  - admin
  - webapp
techStack:
  - javascript
  - couchdb
  - pouchdb
  - angularjs
tags:
  - privilege-escalation
  - validate_doc_update
  - user-settings
  - authorization
  - permissions
  - security
  - couchdb-ddoc
related_workflows:
  - user-registration
source_pr: medic/cht-core#9107
source_sha: b0fa207225a408dccc2b13d922809c76bb28f6d9
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - ddocs/medic-db/medic/validate_doc_update.js
  - ddocs/medic-db/medic-client/validate_doc_update.js
  - admin/src/js/services/privacy-policies.js
  - admin/src/js/controllers/display-privacy-policies-preview.js
  - admin/src/js/main.js
concepts:
  - CouchDB validate_doc_update validation functions
  - field-level write authorization
  - privilege-escalation prevention
  - user-settings document protection
  - DB-admin bypass via the security object (secObj)
related_issues: []
stale: false
---

## Problem

A user can write their own user-settings doc (`_id` `org.couchdb.user:<name>`, `type: 'user-settings'`) in the medic database, either through direct API calls or by editing it in PouchDB and letting it replicate. Its `roles` array shadows the authoritative `_users` doc. An edited copy can therefore drift from `_users`, mislead code that reads the medic copy, or let a malicious user rewrite their own roles shadow. The issue rated the severity low because the shadow roles are not authoritative on the server.

## Root Cause

Before this PR, the medic-client `validate_doc_update` checked only the structure of user-settings docs. `validateUserSettings()` checked the `_id` prefix and case, `name`, the type of `known`, and that `roles` exists, but nothing about who was writing. The medic ddoc's `checkAuthority()` did not look at user-settings at all. Separately, the medic ddoc's `isDbAdmin()` looped with `for (var i = 0; i < userCtx.roles; i++)`, missing `.length`, so the loop did not run for role names. Users who were admins by role in the database security object (`secObj.admins.roles`) were therefore not treated as DB admins.

## Solution

- `ddocs/medic-db/medic-client/validate_doc_update.js`: the function now takes `secObj` and adds two helpers, `hasRole` (`var hasRole = function(roles, role)`) and `isDbAdmin`. `isDbAdmin` is true for the `_admin` role, or for a name or role listed in `secObj.admins`, and DB admins return early before any other check. For `type === 'user-settings'`, `authorizeUserSettings()` now runs after `validateUserSettings()`. It throws `forbidden` with "You are not authorized to create user-settings" when there is no `oldDoc`. It throws "You are not authorized to edit roles" when `oldDoc.roles` is not an object, or when `newDoc.roles` differs from it in length or in any element by position. Only `roles` is compared; other fields, including `known` and `privacy_policy_acceptance_log`, stay writable by the user.
- `ddocs/medic-db/medic/validate_doc_update.js`: `hasRole` now takes a roles array, and `isDbAdmin` loops with `i < userCtx.roles.length` over `secObj.admins.roles`.
- Admin app: the PR deleted the `PrivacyPolicies` service (`admin/src/js/services/privacy-policies.js`) and its spec, and dropped its `require` from `admin/src/js/main.js`. Its `decodeUnicode` logic, the only part the admin app used, was inlined into `admin/src/js/controllers/display-privacy-policies-preview.js`.

## Code Patterns

Authority check inside `validate_doc_update`: return early for DB admins (`isDbAdmin(userCtx, secObj)`, which checks `_admin` and `secObj.admins.names`/`secObj.admins.roles`). Then compare `oldDoc` with `newDoc` on the protected field and `throw({ forbidden: msg })` (via `_err`) on any difference, and reject creation when `oldDoc` is absent. An array field is compared by length and then element by element.

## Design Choices

The rule is enforced in the database (`validate_doc_update`) rather than in application code, so it covers both routes the issue names: direct API/CouchDB writes and edits replicated up from PouchDB. CouchDB runs every design doc's `validate_doc_update` on each write to the medic database, so the check in `medic-client` applies on the server. That file's header comment reserves it for structure checks "irrespective of authority", yet the PR put the authority check there and added no user-settings check to the medic ddoc. The early `isDbAdmin()` return also exempts DB admins from medic-client's form `_id` and user-settings structure checks, which applied to them before.

## Related Files

- ddocs/medic-db/medic/validate_doc_update.js
- ddocs/medic-db/medic-client/validate_doc_update.js
- webapp/tests/mocha/unit/validate_doc_update.spec.js
- admin/src/js/services/privacy-policies.js (deleted)
- admin/src/js/controllers/display-privacy-policies-preview.js
- admin/src/js/main.js
- admin/tests/unit/services/privacy-policies.spec.js (deleted)

## Testing

`webapp/tests/mocha/unit/validate_doc_update.spec.js` (modified) loads both ddocs' validators. It groups the user-settings cases under `describe('type:user-settings')` and adds four cases: "does not allow non-admins to change roles", "allows admins to change roles", "allows everyone to update their own privacy policy acceptance", and "allows everyone to update their own known status". Existing tests were converted from `done` callbacks to synchronous functions, and "only db and national admins are allowed change their own place" became "only db admins are allowed change their own place". The admin `admin/tests/unit/services/privacy-policies.spec.js` was deleted along with the service.

## Related Issues

- #8886: "Block users from editing important fields in user settings docs" (this draft's issue)

## Domain Rationale

**Fit:** strong

The PR adds an authorization rule: only DB admins may create user-settings docs or change their `roles`. It also fixes how the medic ddoc recognises DB admins by role. Both are roles and access-control logic. The CouchDB design doc is only where the rule is enforced, and no replication or sync behaviour changes.

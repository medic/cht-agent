---
id: cht-core-9108
category: bug
domain: authentication
domainFit: strong
issueNumber: 9108
issueUrl: https://github.com/medic/cht-core/issues/9108
title: Block non-admin users from updating admin-only docs by also checking oldDoc in validate_doc_update
lastUpdated: '2026-09-29'
summary: Non-admin users could modify admin-only docs because the medic ddoc's `validate_doc_update` classified only the incoming `newDoc`, so a write whose new revision no longer looked admin-only (for example a `form` doc saved with another `type`) passed. The fix also classifies `oldDoc` and rejects a non-admin write when either revision is admin-only.
services:
  - webapp
techStack:
  - javascript
  - couchdb
  - mocha
tags:
  - validate-doc-update
  - access-control
  - authorization
  - admin-only-docs
  - protected-docs
  - couchdb-validation
  - security
related_workflows: []
source_pr: medic/cht-core#9109
source_sha: 2bebd76e75044fe677885284d13924e662a617a3
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - ddocs/medic-db/medic/validate_doc_update.js
  - webapp/tests/mocha/unit/validate_doc_update.spec.js
concepts:
  - CouchDB validate_doc_update validation function
  - Role-based access control / authorization
  - Admin-only (protected) documents
  - Server-side write validation during replication
  - Defense against malicious offline replication
related_issues: []
stale: false
---

## Problem

Non-admin users could modify admin-only docs. These are the documents the medic ddoc reserves for DB admins by `type` (`form`, `translations` and `token_login` as of this PR) or by `_id` (any `_design/` doc, plus `resources`, `service-worker-meta`, `zscore-charts`, `settings`, `branding`, `partners`, `privacy-policies` and `extension-libs`). On master the lists also include the `ui-extension` type, which arrived with the ui-extensions epic (PR #11050), and the `migration-log` id, added by PR #10187. The public issue withholds the details. The check applies to every user write that reaches CouchDB, whether made directly or replicated up from a device.

## Root Cause

Before this PR, `checkAuthority()` in `ddocs/medic-db/medic/validate_doc_update.js` already rejected non-admin writes to admin-only docs with "You are not authorized to edit admin only docs", but its condition was `if (isAdminOnlyDoc(newDoc)) {`, which tests the new revision alone. `isAdminOnlyDoc` matches on `_id` (the `_design/` prefix or `ADMIN_ONLY_IDS`) or on `type` (`ADMIN_ONLY_TYPES`). A non-admin could therefore overwrite a type-classified doc, such as a form or translations doc, by saving a revision with a different `type`, or delete one, because a deletion stub carries no `type`; the new tests cover the type swap (`type: 'feedback'`). Id-classified docs were already covered, because the new revision keeps the same `_id`.

## Solution

The guard became `if (isAdminOnlyDoc(newDoc) || (oldDoc && isAdminOnlyDoc(oldDoc)))`, so a non-admin write is rejected when either the stored revision or the incoming one is admin-only. DB admins still return early through `isDbAdmin()` before this check.

## Code Patterns

Authorization guard inside a CouchDB `validate_doc_update` function (`function(newDoc, oldDoc, userCtx, secObj)`): resolve admin status first (`isDbAdmin`, meaning the `_admin` role or a name or role in `secObj.admins`) and return early. Then classify both `newDoc` and `oldDoc` against the admin-only set, and `throw({ forbidden: msg })` (via `_err`) if either matches. Classifying only the incoming revision lets a writer escape the check by changing the field the classification keys on. See ddocs/medic-db/medic/validate_doc_update.js.

## Design Choices

The fix stays in the medic ddoc's `validate_doc_update`, which CouchDB runs on every write to the medic database. It closes the gap by classifying the stored revision as well as the incoming one. `oldDoc` is null when a doc is created, hence the `oldDoc &&` guard.

## Related Files

- ddocs/medic-db/medic/validate_doc_update.js
- webapp/tests/mocha/unit/validate_doc_update.spec.js

## Testing

`webapp/tests/mocha/unit/validate_doc_update.spec.js` (modified). The existing creation cases, now under the describe "only db and national admins are allowed to create...", still assert that `_admin` is allowed and that the `national_admin` and `test` roles are forbidden. A new block, "only db and national admins are allowed to update...", covers two kinds of update: forms and translations docs rewritten as `type: 'feedback'`, and `extension-libs`, `branding` and `partners` docs given an extra field. Each case asserts that `_admin` is allowed and a `test`-role user is forbidden. Despite both describe names, no case expects `national_admin` to be allowed.

## Related Issues

- #9108: "Admin only docs can be modified by non-admin users" (this draft's issue)

## Domain Rationale

**Fit:** strong

The PR changes who may write admin-only docs: it widens the authority check in the medic ddoc's `validate_doc_update` so that non-admins cannot modify them by changing the doc's `type`. That is role-based access control. CouchDB is only where the check is enforced.

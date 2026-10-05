---
id: cht-core-10631
category: improvement
domain: authentication
domainFit: strong
issueNumber: 10631
issueUrl: https://github.com/medic/cht-core/issues/10631
title: Enforce admin-only write access for ui-extension doc type in validate_doc_update
lastUpdated: '2026-10-05'
summary: The medic ddoc's `validate_doc_update` did not treat `ui-extension` docs as admin-only, so non-admin users could create or edit them. The fix adds `'ui-extension'` to `ADMIN_ONLY_TYPES`, so non-admin writes of docs with `type` `ui-extension` are rejected while DB admins can still write them.
services:
  - api
techStack:
  - javascript
  - couchdb
tags:
  - authorization
  - access-control
  - admin-only
  - ui-extension
  - validate_doc_update
  - couchdb-validation
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10994
source_sha: d5bd8c1fe9098ae310ee7e82ddeed4b44120e370
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - ddocs/medic-db/medic/validate_doc_update.js
concepts:
  - document write validation
  - admin-only doc types
  - authorization
  - CouchDB validate_doc_update
  - database-level access control
related_issues:
  - cht-core-10224
stale: true
---

> **Epic child.** PR #10994 was squash-merged into the feature branch `10224-ui-extensions`
> (`d5bd8c1fe`, 2026-05-11), not into master. That branch reached master as PR #11050
> (`180c29ecf`, 2026-06-23). Its own PR number is stamped nowhere on master, which is
> why this draft's `source_sha` does not resolve in a plain clone. Fetch it with
> `git fetch origin +refs/pull/11050/head:refs/verify/pr11050` — the epic PR's head ref.

## Problem

UI extensions are docs in the medic database with `_id` `ui-extension:<name>`, carrying an `extension.js` script attachment that the webapp loads. The medic ddoc's `ddocs/medic-db/medic/validate_doc_update.js` reserves some doc types for DB admins through `ADMIN_ONLY_TYPES`, which then held `form`, `translations` and `token_login`. `ui-extension` was not on that list, so non-admin users could create or edit these docs directly against the database. The issue asked for the protection that `form` docs already had.

## Root Cause

`checkAuthority()` rejects a non-admin write with "You are not authorized to edit admin only docs" when `isAdminOnlyDoc()` matches the new or the stored revision. `isAdminOnlyDoc()` matches a `_design/` id, an id in `ADMIN_ONLY_IDS`, or a `type` in `ADMIN_ONLY_TYPES`. None of these covered `ui-extension` docs, so they passed the admin-only check like any other user doc.

## Solution

Appended `'ui-extension'` to `ADMIN_ONLY_TYPES` in `ddocs/medic-db/medic/validate_doc_update.js`, making it `[ 'form', 'translations', 'token_login', 'ui-extension' ]`; this is the only line the PR changes. A non-admin write in which either the new or the stored revision has its `type` set to `'ui-extension'` is now rejected with that forbidden error, while DB admins (`isDbAdmin()`) return before the check. The file is byte-identical at this PR, at the epic squash `180c29ecf`, and on master.

## Code Patterns

To make a doc type writable only by DB admins, add its `type` string to `ADMIN_ONLY_TYPES` in ddocs/medic-db/medic/validate_doc_update.js (for fixed ids, `ADMIN_ONLY_IDS`); `checkAuthority()` then rejects non-admin writes through `isAdminOnlyDoc()`. `form`, `translations` and `token_login` are protected the same way.

## Design Choices

The restriction sits in the medic ddoc's `validate_doc_update`, which CouchDB runs on every write to the medic database. It therefore applies to direct CouchDB requests, writes proxied by api, and replication alike, rather than depending on application-layer checks.

The check keys on `type`, not on the `ui-extension:` id prefix. At this PR's anchor the api's loader (`api/src/services/ui-extension.js`) still selected extension docs by id prefix alone. Later commits on the feature branch made it also require the doc's `type` to be `'ui-extension'` (`doc.type === TYPE`, fee56a829, "Update api to check type of ui-extension docs when loading") and then removed the api's ui-extension endpoints (09391e322), so that file is not on master. On master the loader is the webapp's webapp/src/ts/services/ui-extensions.service.ts: it reads ids under `PREFIXES.UI_EXTENSION` and keeps only docs with `type === DOC_TYPES.UI_EXTENSION`, which is the type this check protects.

## Related Files

- ddocs/medic-db/medic/validate_doc_update.js

## Testing

No automated test covers the new type: the PR changed only `ddocs/medic-db/medic/validate_doc_update.js`, and `webapp/tests/mocha/unit/validate_doc_update.spec.js` has no `ui-extension` case, either at this PR or on master. The PR description records a manual check instead, run directly against CouchDB (`localhost:5984/medic`): an admin (`medic`) `POST` of `{"_id": "ui-extension:hello-world", "type": "ui-extension"}` returned `{"ok": true, ...}`, and a `POST` of `{"_id": "ui-extension:non-admin-test", "type": "ui-extension"}` as the non-admin user `testuser` returned `{"error": "forbidden", "reason": "You are not authorized to edit admin only docs"}`. This is the manual test the issue asked for in place of automated tests.

## Related Issues

- #10631: "Update `medic` db validation to support `ui-extension` doc type" (this draft's issue)
- #10224: "Support custom UI Extensions" — the epic whose feature branch this PR merged into; it reached master as PR #11050

## Domain Rationale

**Fit:** strong

The PR's only change is to who may write a doc type: it adds `ui-extension` to the admin-only types enforced by the medic ddoc's `validate_doc_update`. That is role-based write access control. The UI extensions feature itself (loading, rendering, configuration) is outside this change; `related_workflows: [ui-extensions]` links the draft to that workstream.

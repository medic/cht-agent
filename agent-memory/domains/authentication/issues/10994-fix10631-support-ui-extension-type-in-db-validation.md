---
id: cht-core-10631
category: improvement
domain: authentication
domainFit: strong
issueNumber: 10631
issueUrl: https://github.com/medic/cht-core/issues/10631
title: Enforce admin-only write access for ui-extension doc type in validate_doc_update
lastUpdated: '2026-06-22'
summary: The validate_doc_update validation function did not treat ui-extension documents as admin-only, so non-admin users could create or edit them via the database/API. The fix adds the ui-extension type to the admin-only doc types so only admins can write these docs.
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
related_issues: []
stale: false
---

## Problem

The ui-extension document type was not included in the admin-only doc types enforced by validate_doc_update.js. As a result, non-admin users could create or edit ui-extension:* documents directly against the database/API, even though UI extension documents are sensitive configuration that should only be writable by admins.

## Root Cause

validate_doc_update.js maintains a list of admin-only doc types and rejects writes to those docs from non-admin users with 'You are not authorized to edit admin only docs'. The ui-extension type was missing from that list, so writes of that type fell through to the permissive default path for any authenticated user.

## Solution

Added the ui-extension doc type to the set of admin-only types checked in validate_doc_update.js. Write requests for documents of type ui-extension from non-admin users are now rejected with a forbidden error, while admin users can still create and edit them.

## Code Patterns

Database-level write authorization by doc type is enforced by extending the admin-only doc-type guard in ddocs/medic-db/medic/validate_doc_update.js — adding a new type string to the admin-only list is the canonical way to lock down writes for a doc type in cht-core.

## Design Choices

Enforcing the restriction in validate_doc_update.js (CouchDB's validation hook) makes it apply uniformly across all write paths — direct CouchDB requests, the api service, and replication — rather than relying on application-layer checks that could be bypassed by writing directly to the database.

## Related Files

- ddocs/medic-db/medic/validate_doc_update.js

## Testing

Manual verification documented in the PR via curl: an admin POST of a {type:'ui-extension'} document to the medic database succeeds, while a non-admin POST is rejected with 'forbidden: You are not authorized to edit admin only docs'. No automated tests were included in the diff (single file changed). Reviewer (jkuester) confirmed it works as expected.

## Related Issues

- #10631: support ui-extension type in db validation so only admins can write ui-extension docs

## Domain Rationale

**Fit:** strong

The change modifies CouchDB's validate_doc_update authorization guard to enforce admin-only write access for a doc type; per the taxonomy, roles/permissions/authorization work belongs to authentication. The underlying feature is part of the ui-extensions workstream, captured in relatedWorkflows.

---
id: cht-core-9109
category: bug
domain: authentication
domainFit: strong
issueNumber: 9109
issueUrl: https://github.com/medic/cht-core/issues/9109
title: Block non-admin users from updating admin-only (protected) documents in validate_doc_update
lastUpdated: '2026-06-23'
summary: Non-admin users could overwrite admin-only/protected documents because the medic database's validate_doc_update function had no guard for them; the fix rejects any create/update/delete of admin-only docs by non-admin users.
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

Non-admin users could update or overwrite 'admin-only' (protected) documents — configuration/system documents intended to be editable only by administrators. The medic database's validate_doc_update function did not reject these writes, so an offline user could modify a protected document locally and replicate the change up to the server, affecting the whole instance.

## Root Cause

validate_doc_update.js lacked an authorization guard for admin-only documents on the write path: it did not verify that the document being created/updated/deleted was outside the protected set before permitting a non-admin user's write, leaving an unauthorized-overwrite / privilege-escalation gap.

## Solution

Extended ddocs/medic-db/medic/validate_doc_update.js to identify admin-only/protected documents and throw a forbidden/unauthorized error when a user who is not a database admin attempts to write them. Added unit tests asserting admins are allowed while non-admin users are blocked.

## Code Patterns

Authorization guard inside a CouchDB validate_doc_update(newDoc, oldDoc, userCtx, secObj) function: resolve admin status (userCtx roles / _admin / secObj), classify the target document against the admin-only/protected set, and throw({ unauthorized|forbidden: '...' }) to reject the write at the database layer — enforced uniformly across all write paths (offline replication, API), not just in the UI. See ddocs/medic-db/medic/validate_doc_update.js.

## Design Choices

Enforce the restriction in the database-layer validate_doc_update function rather than only in API/application code, so the rule applies to every write path and cannot be bypassed by a crafted offline client pushing changes during replication.

## Related Files

- ddocs/medic-db/medic/validate_doc_update.js
- webapp/tests/mocha/unit/validate_doc_update.spec.js

## Testing

Added/updated Mocha unit tests in webapp/tests/mocha/unit/validate_doc_update.spec.js covering the new behavior — database-admin users can update admin-only docs while non-admin users are rejected.

## Related Issues

- #9108: block overwriting/updating admin-only (protected) documents

## Domain Rationale

**Fit:** strong

The PR enforces role-based write authorization in the medic database's validate_doc_update function, blocking non-admin users from modifying admin-only/protected documents. Per the roles/permissions rule, access control by user role is canonically the authentication domain.

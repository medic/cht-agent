---
id: cht-core-8886
category: bug
domain: authentication
domainFit: strong
issueNumber: 8886
issueUrl: https://github.com/medic/cht-core/issues/8886
title: Block non-admin users from editing protected fields in their own user-settings via validate_doc_update
lastUpdated: '2026-06-23'
summary: Users had write access to their own user-settings document and could modify security-sensitive fields (e.g. roles, facility), enabling privilege escalation. Added validate_doc_update checks in both the server (medic) and offline (medic-client) design docs to reject such edits by non-admin users.
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
  - mirrored server/offline (medic and medic-client) design-doc validation
related_issues: []
stale: false
---

## Problem

A user has write access to their own user-settings document, which replicates to their device. Nothing enforced field-level immutability, so a non-admin user could edit important/protected fields (such as roles, facility_id, or contact_id) and potentially escalate their own privileges or change their data access.

## Root Cause

The validate_doc_update validation functions in the medic and medic-client design docs enforced document-level write access but did not restrict which fields a non-admin user could change on a user-settings document, leaving sensitive fields mutable by the user themselves.

## Solution

Updated validate_doc_update.js in both ddocs/medic-db/medic and ddocs/medic-db/medic-client to compare old and new document values for the set of protected user-settings fields and reject (forbidden) changes made by non-admin users. Companion changes were made to the admin privacy-policies service and preview controller, with unit tests added for both the validation logic and the admin service.

## Code Patterns

Field-level write authorization in CouchDB validate_doc_update: compare oldDoc vs newDoc for a defined set of protected fields and throw { forbidden } when a non-admin user attempts to change them (ddocs/medic-db/medic/validate_doc_update.js, ddocs/medic-db/medic-client/validate_doc_update.js). The check is mirrored across the server-side (medic) and offline (medic-client) design docs so offline/replicated edits are rejected too.

## Design Choices

Enforce the rule at the database/validation layer (validate_doc_update) rather than only in application code, so it cannot be bypassed via offline PouchDB edits, direct CouchDB writes, or replication. Mirroring the validation in both the medic (server) and medic-client (offline) ddocs keeps online and offline enforcement consistent.

## Related Files

- ddocs/medic-db/medic/validate_doc_update.js
- ddocs/medic-db/medic-client/validate_doc_update.js
- webapp/tests/mocha/unit/validate_doc_update.spec.js
- admin/src/js/services/privacy-policies.js
- admin/src/js/controllers/display-privacy-policies-preview.js
- admin/src/js/main.js
- admin/tests/unit/services/privacy-policies.spec.js

## Testing

Added/modified unit tests for the validate_doc_update validation logic in webapp/tests/mocha/unit/validate_doc_update.spec.js and for the admin privacy-policies service in admin/tests/unit/services/privacy-policies.spec.js.

## Related Issues

- #8886: Block users from editing important/protected fields in their own user settings (privilege-escalation prevention)

## Domain Rationale

**Fit:** strong

The PR enforces field-level write authorization on user-settings documents to stop users from changing privileged fields (e.g. roles, facility, contact), which is a privilege-escalation/permissions concern. Per the roles/permissions rule, that lands squarely in authentication rather than data-sync, even though the hook lives in a CouchDB validate_doc_update ddoc.

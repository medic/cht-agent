---
id: cht-core-9593
category: feature
domain: data-sync
domainFit: strong
issueNumber: 9593
issueUrl: https://github.com/medic/cht-core/issues/9593
title: Add replicate_primary_contacts option to replicate primary contacts and their reports/targets at max depth
lastUpdated: '2026-06-22'
summary: Offline users could not replicate primary contacts (and their reports/targets) that fell outside their configured replication depth. This PR adds an opt-in replicate_primary_contacts flag to each replication_depth role config so those documents replicate at max depth, and removes the ability to create feedback docs in the medic db.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - replication
  - replication-depth
  - primary-contacts
  - authorization
  - offline-first
  - couchdb-views
  - report-depth
  - feedback-docs
related_workflows: []
source_pr: medic/cht-core#9593
source_sha: 80760a6d2155e5f77cb5278651b0fe63de7ed0fc
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/authorization.js
  - api/src/services/bulk-docs.js
  - api/src/services/db-doc.js
  - ddocs/medic-db/medic/views/contacts_by_depth/map.js
  - ddocs/medic-db/medic/views/contacts_by_primary_contact/map.js
concepts:
  - replication depth
  - document-level authorization for replication
  - offline-first replication
  - CouchDB map/reduce views
  - primary contacts
  - report_depth
  - changes feed filtering
related_issues: []
stale: false
---

## Problem

Offline users replicating a subset of the database based on replication_depth could not access primary contacts of places at the edge of (or beyond) their configured depth, nor those primary contacts' associated reports and target documents. There was no mechanism to ensure a place's primary contact replicated to roles (e.g. supervisors) that needed it. Additionally, feedback docs could be created in the medic db where they did not belong.

## Root Cause

The authorization service computes the set of replicable documents strictly by contact depth, so primary contacts (and their reports/targets) sitting outside a user's depth window were excluded. The contacts_by_depth and contacts_by_primary_contact views and the bulk-docs/db-doc authorization checks had no concept of replicating primary contacts independently of standard depth limits.

## Solution

Added a per-role replicate_primary_contacts boolean to the replication_depth config. When set, the authorization service includes the primary contacts of replicated places at max depth, along with their associated reports and target documents. Updated the contacts_by_depth and added/extended contacts_by_primary_contact CouchDB map views to support reverse lookups, and threaded the new authorization logic through bulk-docs.js and db-doc.js. Also blocked creation of feedback docs in the medic db.

## Code Patterns

Per-role opt-in flag layered onto existing replication_depth config consumed by api/src/services/authorization.js, which emits allowed doc keys for the changes/replication feed. A dedicated CouchDB view (ddocs/medic-db/medic/views/contacts_by_primary_contact/map.js) emits contacts keyed by their primary_contact reference so the authorization service can resolve primary contacts without scanning all contacts; bulk-docs.js and db-doc.js reuse the same authorization helper to gate writes/reads.

## Design Choices

Implemented as an opt-in per-role flag inside the existing replication_depth structure rather than a global setting, preserving backwards compatibility — roles without the flag behave exactly as before. Reused the existing depth-based authorization machinery and added a purpose-built reverse-lookup view instead of broad scans, keeping replication-set computation efficient.

## Related Files

- api/src/services/authorization.js
- api/src/services/bulk-docs.js
- api/src/services/db-doc.js
- ddocs/medic-db/medic/views/contacts_by_depth/map.js
- ddocs/medic-db/medic/views/contacts_by_primary_contact/map.js
- api/tests/mocha/services/authorization.spec.js
- api/tests/mocha/services/bulk-docs.spec.js
- api/tests/mocha/services/db-doc.spec.js
- tests/integration/api/controllers/bulk-docs.spec.js
- tests/integration/api/controllers/bulk-get.spec.js
- tests/integration/api/controllers/db-doc.spec.js
- tests/integration/api/controllers/replication.spec.js

## Testing

Unit tests added/updated in api/tests/mocha/services/authorization.spec.js, bulk-docs.spec.js, and db-doc.spec.js to cover the new primary-contact authorization logic, plus integration tests in tests/integration/api/controllers/ for bulk-docs, bulk-get, db-doc, and replication verifying that primary contacts and their reports/targets replicate at max depth and that feedback docs cannot be created in the medic db.

## Related Issues

- #8034: Replicate primary contacts (and their reports/targets) at max depth

## Domain Rationale

**Fit:** strong

The PR extends CHT's offline replication model — the authorization service and contacts_by_depth/contacts_by_primary_contact views compute which documents (primary contacts plus their reports and targets) sync to a user's device based on a new replication_depth flag. Although it touches authorization.js, this is replication-scope computation (what gets synced), not auth/login or RBAC permissions, so data-sync is the squarely correct domain.

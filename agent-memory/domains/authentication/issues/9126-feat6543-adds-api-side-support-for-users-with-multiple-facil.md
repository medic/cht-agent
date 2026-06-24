---
id: cht-core-9126
category: feature
domain: authentication
domainFit: strong
issueNumber: 9126
issueUrl: https://github.com/medic/cht-core/issues/9126
title: Add API-side support for users with multiple facilities via new v3 users API
lastUpdated: '2026-06-23'
summary: 'CHT users could previously be associated with only a single facility (place). This PR adds API-side multi-facility support: a new /v3/users API to create and update users with an array of existing facility UUIDs, plus user-management library and authorization changes so a user''s doc download/upload permissions span all of their facilities.'
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
  - express
  - mocha
tags:
  - user-management
  - multiple-facilities
  - authorization
  - api-versioning
  - roles
  - replication-permissions
related_workflows:
  - user-registration
source_pr: medic/cht-core#9126
source_sha: 2fdddd07194e104c3958646cc5db9251694c8353
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/users.js
  - api/src/routing.js
  - api/src/services/authorization.js
  - ddocs/users-db/users/views/users_by_field/map.js
  - shared-libs/user-management/src/users.js
  - shared-libs/user-management/src/roles.js
  - shared-libs/user-management/src/libs/facility.js
  - shared-libs/contacts/src/places.js
concepts:
  - multi-facility user model
  - API versioning (v3 endpoint)
  - authorization / replication doc-access scoping
  - user provisioning
  - CouchDB design-doc views (users_by_field)
  - facility-contact association constraints
  - backwards compatibility
related_issues: []
stale: false
---

## Problem

Each CHT user could be linked to only a single facility. Health workers operating across more than one facility could not be represented as one account with access to documents from all their assigned facilities — the v1 users API accepted only one facility, and the authorization logic that computes a user's replicable (download/upload) document set was scoped to a single facility subtree.

## Root Cause

The user-management shared library (users.js, roles.js, facility.js), the api users controller, the authorization service, and the users_by_field CouchDB view all assumed a single facility_id per user. Doc download/upload permission computation unioned over only one facility's subtree, and the view indexed a single facility, so a user could not be authorized for documents across multiple places.

## Solution

Introduced a new /v3/users API (create and update) that accepts an array of UUIDs of existing facilities, accepting the same payload shape as /v1/users. Updated the user-management shared library to model multiple facilities and the authorization service so a user's downloadable/uploadable doc set is the union across all their facilities. Updated the users_by_field view map to index multiple facilities and the recent-users search API to handle multi-facility users. Constraints: when creating a multi-facility user the contact must fall within one of the facilities; v3 does not create facilities or contacts, only links existing facility UUIDs.

## Code Patterns

New API version namespace registered in api/src/routing.js delegating to api/src/controllers/users.js while normalizing single-vs-array facility input. api/src/services/authorization.js iterates over the user's facility list to union allowed doc subtrees for replication. ddocs/users-db/users/views/users_by_field/map.js emits one index row per facility so multi-facility users are discoverable by any of their places. Facility resolution/validation centralized in shared-libs/user-management/src/libs/facility.js.

## Design Choices

Added a new v3 API version instead of mutating v1/v2 to preserve backwards compatibility with existing single-facility clients. v3 deliberately performs no side-effect creation (no facilities, no contact) and only links existing facility UUIDs, keeping the endpoint narrowly scoped. Validation that all facilities share the same contact type was intentionally deferred (called out in the PR as future work). Requiring the contact to live within one of the facilities preserves contact-facility consistency.

## Related Files

- api/src/controllers/users.js
- api/src/routing.js
- api/src/services/authorization.js
- ddocs/users-db/users/views/users_by_field/map.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/src/roles.js
- shared-libs/user-management/src/libs/facility.js
- shared-libs/contacts/src/places.js

## Testing

Added/updated Mocha unit tests for the users controller, authorization service, user-management roles and users, and contacts places. Updated integration tests for bulk-docs, login, replication, and the users controller (verifying multi-facility doc download/upload permissions), plus the sentinel create-user-for-contacts transition. Updated several wdio e2e suites (contacts editing/placement, db-sync, offline-user all-permissions, sms export, target-aggregates, replace-user) to exercise multi-facility users.

## Related Issues

- #6543: Support for users assigned to multiple facilities (places)

## Domain Rationale

**Fit:** strong

The PR adds user-account provisioning (a new v3 users API to create/update users), role handling, and authorization changes that govern which documents a multi-facility user may download/upload — user management, roles, and access control are canonically the authentication domain. Per guidance, roles/permissions work belongs to authentication even though it ultimately gates replication.

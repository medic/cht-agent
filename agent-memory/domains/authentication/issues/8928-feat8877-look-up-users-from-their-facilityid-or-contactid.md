---
id: cht-core-8928
category: feature
domain: authentication
domainFit: strong
issueNumber: 8928
issueUrl: https://github.com/medic/cht-core/issues/8928
title: Extend GET /api/v2/users to look up users by facility_id and/or contact_id
lastUpdated: '2026-06-23'
summary: There was no way to query the users API to find which users are linked to a given facility or contact. This PR extends `GET /api/v2/users` to accept `facility_id` and/or `contact_id` query parameters (gated behind `can_view_users`), backed by a new `_users` db view and a migration that backfills `contact_id` onto existing user docs.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - user-management
  - users-api
  - couchdb-view
  - migration
  - facility-lookup
  - contact-lookup
  - permissions
related_workflows:
  - data-migration
source_pr: medic/cht-core#8928
source_sha: 5e9032d87a10e268b052aa5279e9b88995b3a090
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/users.js
  - shared-libs/user-management/src/users.js
  - shared-libs/user-management/src/libs/facility.js
  - api/src/migrations/add-contact-id-to-user-docs.js
  - ddocs/users-db/users/views/users_by_field/map.js
concepts:
  - permission-gated API endpoint (can_view_users)
  - indexed CouchDB map view for user lookup
  - user docs in the _users database
  - idempotent backfill migration
  - query-parameter-based filtering on an existing route
related_issues: []
stale: false
---

## Problem

The `GET /api/v2/users` route could not be filtered, so there was no efficient, supported way to find which users are associated with a particular facility (`facility_id`) or contact (`contact_id`). User docs also did not consistently carry a `contact_id` field that could be indexed for such a lookup.

## Root Cause

The users API exposed no filtering mechanism for `facility_id`/`contact_id`, there was no view in the `_users` db indexing users by those fields, and existing user docs lacked a `contact_id` field to index against.

## Solution

Extended `GET /api/v2/users` (controller in api/src/controllers/users.js) to accept `facility_id` and/or `contact_id` query parameters and return the matching users, reusing the existing `can_view_users` permission gate. Added a `users_by_field` map view (ddocs/users-db/users/views/users_by_field/map.js) to index users by these fields, added the query logic in shared-libs/user-management (users.js, libs/facility.js), updated setup/databases ddoc handling, and added the `add-contact-id-to-user-docs` migration to backfill `contact_id` onto existing user docs so they are indexable.

## Code Patterns

CouchDB view `ddocs/users-db/users/views/users_by_field/map.js` emits user fields (facility_id, contact_id) as view keys for indexed lookup, queried from api/src/controllers/users.js. Idempotent backfill migration pattern in api/src/migrations/add-contact-id-to-user-docs.js populates a new field onto existing `_users` docs. New ddoc/view bundled via scripts/build/ddoc-compile.js.

## Design Choices

Reused the existing `GET /api/v2/users` route and `can_view_users` permission instead of adding a new endpoint, keeping the API surface and authorization model consistent. Backfilling `contact_id` via a migration (rather than computing it at read time) allows the lookup to be served by a single indexed view. Reviewer dianabarsan was specifically asked to validate the new migration and the new `_users` db views before merge.

## Related Files

- api/src/controllers/users.js
- api/src/migrations/add-contact-id-to-user-docs.js
- api/src/services/setup/databases.js
- ddocs/users-db/users/_id
- ddocs/users-db/users/views/users_by_field/map.js
- scripts/build/ddoc-compile.js
- shared-libs/user-management/src/libs/facility.js
- shared-libs/user-management/src/users.js
- tests/integration/api/controllers/users.spec.js

## Testing

Added mocha unit tests for the controller (api/tests/mocha/controllers/users.spec.js), the migration (api/tests/mocha/migrations/add-contact-id-to-user-docs.spec.js), setup/databases and utils, and shared-libs/user-management (users.spec.js, libs/facility.spec.js). Added integration tests for the migration (api/tests/integration/migrations/add-contact-id-to-user-docs.js) and the users API route (tests/integration/api/controllers/users.spec.js). Reviewers requested additional test scenarios which the author added.

## Related Issues

- #8877: Look up users from their facility_id or contact_id
- medic/cht-docs#1318: docs for the new facility_id/contact_id user lookup query parameters

## Domain Rationale

**Fit:** strong

The PR extends user management — the `GET /api/v2/users` route, the `_users` database views/docs, and access gated behind the `can_view_users` permission — which is canonically the authentication domain. The lookup keys (facility_id/contact_id) reference contacts, but the entities being queried, managed, and returned are users, so this is not contacts.

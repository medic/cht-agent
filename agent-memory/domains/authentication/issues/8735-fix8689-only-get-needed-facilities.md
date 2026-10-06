---
id: cht-core-8689
category: bug
domain: authentication
domainFit: strong
issueNumber: 8689
issueUrl: https://github.com/medic/cht-core/issues/8689
title: 'Users API: fetch only the place and contact docs the listed users need instead of every contact, to fix response time'
lastUpdated: '2026-10-05'
summary: 'The users list API (GET /api/v1/users and /api/v2/users) timed out on large instances because it loaded every contact document on the server (places and people, via the medic-client/contacts_by_type view) to resolve each user''s place and contact. The fix fetches only the place and contact docs the returned users reference, by id.'
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - performance
  - optimization
  - users-api
  - facilities
  - user-management
related_workflows:
  - user-registration
source_pr: medic/cht-core#8735
source_sha: 43a1683944df4c28dc3a7cc026bd98a10da69958
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/user-management/src/libs/facility.js
  - shared-libs/user-management/src/users.js
concepts:
  - query scoping / fetch-by-id
  - user-facility association
  - users API enrichment
  - performance optimization
related_issues: []
stale: false
---

## Problem

The users API exhibited poor (slow) response times on servers with a high number of facilities — the issue reports `/api/v1/users` and `/api/v2/users` returning 504 Gateway Time-out on an instance with about 8,400 `_users` docs and 4.6 million medic docs. Listing users became progressively more expensive as the total contact count grew, because every contact doc was loaded regardless of how many users were actually being returned.

## Root Cause

`getList` in shared-libs/user-management/src/users.js called `getFacilities()`, which queried `medic-client/contacts_by_type` with `include_docs: true` — every place and person on the server — and then looked each user's place and contact up in that set, so the cost scaled with the total number of contacts rather than with the docs actually referenced by the users being returned.

## Solution

Added shared-libs/user-management/src/libs/facility.js, whose `list()` collects the users' `facility_id` values and their settings docs' `contact_id` values and fetches just those docs with one `db.medic.allDocs({ keys: Array.from(ids), include_docs: true })`; `getList` in shared-libs/user-management/src/users.js now calls it and `getFacilities()` was removed. This cuts the CouchDB reads to the docs the response needs. (On master `list()` takes only the user docs and reads both ids from them, since PR #8928 copied `contact_id` onto `_users` docs.)

## Code Patterns

Scope database reads to the required document IDs (fetch-by-keys) rather than loading an entire collection and filtering/joining in memory — see the facility lookup in shared-libs/user-management/src/libs/facility.js consumed by shared-libs/user-management/src/users.js.

## Design Choices

The author deliberately shipped a simple, high-impact partial fix: it removes the cost that scaled with the total number of contacts but acknowledges the endpoint will still degrade with very large numbers of users (the issue thread names pagination or streaming as the further work large deployments would need). Low-hanging-fruit optimization chosen over a full rewrite.

## Related Files

- shared-libs/user-management/src/libs/facility.js (added)
- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/libs/facility.spec.js (added)
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js

## Testing

Added unit tests for the facility lookup (shared-libs/user-management/test/unit/libs/facility.spec.js, a new file) and updated shared-libs/user-management/test/unit/users.spec.js to stub `facility.list` instead of `getFacilities`. The integration test tests/integration/api/controllers/users.spec.js adds a `POST/GET api/v2/users` case that creates ten users and checks each listed user's place and contact are hydrated; it does not measure response time.

## Related Issues

- #8689: "Users API not responsive" — this draft's issue: `/api/v1/users` and `/api/v2/users` timing out on a large instance

## Domain Rationale

**Fit:** strong

The PR modifies the user-management shared library and the users API, which handle user accounts and their facility associations — squarely the user/account-management side of the authentication domain. The change is a query optimization within that domain, not a sync, contacts, or infrastructure concern.

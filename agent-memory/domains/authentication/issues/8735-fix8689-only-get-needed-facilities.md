---
id: cht-core-8735
category: improvement
domain: authentication
domainFit: strong
issueNumber: 8735
issueUrl: https://github.com/medic/cht-core/issues/8735
title: 'Users API: fetch only the needed facilities instead of all facilities to improve response time'
lastUpdated: '2026-06-23'
summary: The users API responded slowly on servers with many facilities because it loaded every facility document even though only those linked to the returned users were needed. The fix scopes the facility lookup to just the required facilities, significantly improving performance.
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

The users API exhibited poor (slow) response times on servers with a high number of facilities. Listing users became progressively more expensive as the total facility count grew, because facility data was loaded regardless of how many users were actually being returned.

## Root Cause

The facility-fetching logic in the user-management library retrieved all facility documents on the server and then used them, so the cost scaled with the total number of facilities rather than with the set of facilities actually referenced by the users being returned.

## Solution

Changed facility.js and users.js so the API fetches only the facilities needed for the users in the response (scoped by their facility IDs) instead of loading the entire facility set, cutting unnecessary CouchDB reads and data processing.

## Code Patterns

Scope database reads to the required document IDs (fetch-by-keys) rather than loading an entire collection and filtering/joining in memory — see the facility lookup in shared-libs/user-management/src/libs/facility.js consumed by users.js.

## Design Choices

The author deliberately shipped a simple, high-impact partial fix: it removes the scaling-with-facility-count cost but acknowledges the endpoint will still degrade with very large numbers of users (which would require additional per-user scoping). Low-hanging-fruit optimization chosen over a full rewrite.

## Related Files

- shared-libs/user-management/test/unit/libs/facility.spec.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js

## Testing

Unit tests added/updated for the facility lookup and users logic (facility.spec.js, users.spec.js). The reviewer (dianabarsan) added an e2e/integration test in tests/integration/api/controllers/users.spec.js to validate the users API response and confirmed reduced response times when many facilities exist on the server.

## Related Issues

- #8689: users API performing badly — slow response times on servers with a high number of facilities

## Domain Rationale

**Fit:** strong

The PR modifies the user-management shared library and the users API, which handle user accounts and their facility associations — squarely the user/account-management side of the authentication domain. The change is a query optimization within that domain, not a sync, contacts, or infrastructure concern.

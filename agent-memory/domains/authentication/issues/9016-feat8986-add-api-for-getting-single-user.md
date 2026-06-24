---
id: cht-core-8986
category: feature
domain: authentication
domainFit: strong
issueNumber: 8986
issueUrl: https://github.com/medic/cht-core/issues/8986
title: Add GET /api/v2/users/:username endpoint to fetch a single user
lastUpdated: '2026-06-23'
summary: The API could only list all users, with no way to retrieve one user by username. This PR adds a GET /api/v2/users/:username endpoint, wired through the API controller/routing and a new single-user lookup in the user-management shared library.
services:
  - api
techStack:
  - javascript
  - nodejs
  - express
  - couchdb
  - mocha
tags:
  - user-management
  - api
  - rest-api
  - single-user
  - users-endpoint
  - v2-api
related_workflows:
  - user-registration
source_pr: medic/cht-core#9016
source_sha: db531e1e028054fc5146dd4816eb4594ae3ee5b9
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/users.js
  - api/src/routing.js
  - shared-libs/user-management/src/users.js
concepts:
  - REST API endpoint
  - user management
  - GET single resource by key
  - shared-library delegation
  - controller/routing separation
related_issues: []
stale: false
---

## Problem

There was no API to retrieve data about an individual user; only the list-all-users endpoint (GET /api/v2/users) existed, so any consumer needing a single user's data had to fetch and filter the entire user list.

## Root Cause

The API exposed no route or controller handler for fetching an individual user by username, and the user-management shared library had no corresponding single-user lookup function — only bulk listing was implemented.

## Solution

Registered a new GET /api/v2/users/:username route in api/src/routing.js, added a controller handler in api/src/controllers/users.js that resolves the username, and implemented the single-user retrieval logic in shared-libs/user-management/src/users.js, mirroring the existing list-users flow but keyed on a single username.

## Code Patterns

Controller (api/src/controllers/users.js) delegates business logic to the shared-libs/user-management/src/users.js library rather than reimplementing it; the route is declared in api/src/routing.js following the existing /api/v2/users registration pattern, extended with a :username path parameter for single-resource GET.

## Design Choices

Reused the existing user-management shared library instead of duplicating user-lookup logic in the controller, keeping a single source of truth shared across services; the endpoint follows REST conventions (GET /api/v2/users/{username}) so the single-user response shape stays consistent with entries returned by the list endpoint.

## Related Files

- api/src/controllers/users.js
- api/src/routing.js
- api/tests/mocha/controllers/users.spec.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js

## Testing

Added unit tests for the new controller handler (api/tests/mocha/controllers/users.spec.js) and the shared-library single-user function (shared-libs/user-management/test/unit/users.spec.js), plus integration coverage of the endpoint behavior in tests/integration/api/controllers/users.spec.js.

## Related Issues

- #8986: Add API support for retrieving data about a single user (GET /api/v2/users/username)
- #8877: Parent issue this work was split off from — broader user API support
- medic/cht-docs#1350: Documentation PR for the new single-user endpoint

## Domain Rationale

**Fit:** strong

User management (users, their roles and facility associations) is canonically part of the authentication domain in CHT; this PR adds a user-retrieval API endpoint backed by the user-management shared library, a squarely auth-domain concern rather than an external-system integration.

---
id: cht-core-8986
category: feature
domain: authentication
domainFit: strong
issueNumber: 8986
issueUrl: https://github.com/medic/cht-core/issues/8986
title: Add GET /api/v2/users/:username endpoint to fetch a single user
lastUpdated: '2026-10-05'
summary: The API could only list all users, with no way to retrieve one user by username. This PR adds a GET /api/v2/users/:username endpoint, open to holders of `can_view_users` or to the user fetching themselves, wired through the API controller/routing and a new single-user lookup (`getUser`) in the user-management shared library.
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
related_issues:
  - cht-core-8877
stale: false
---

## Problem

There was no API to retrieve data about an individual user; only the list-all-users endpoint (GET /api/v2/users) existed, so any consumer needing a single user's data had to fetch and filter the entire user list.

## Root Cause

The API exposed no route or controller handler for fetching an individual user by username, and the user-management shared library exported no function that returned a single user in the shape `getList`/`mapUsers` produce. Its existing by-name reads did not fill that gap: the private `getUserDoc`/`getUserDocsByName` returned the raw `_users` and user-settings docs, and the exported `getUserSettings({ name })` returned a merged, facility/contact-hydrated user-settings doc that the api authorization middleware used to populate `req.userCtx`.

## Solution

Registered a new GET /api/v2/users/:username route in api/src/routing.js, added a controller handler in api/src/controllers/users.js that resolves the username, and implemented the single-user retrieval logic in shared-libs/user-management/src/users.js, mirroring the existing list-users flow but keyed on a single username. The new handler takes the name `users.v2.get`; the list handlers it displaced were renamed `users.list` (v1) and `users.v2.list`. It allows the request when the requester has `can_view_users` or is fetching their own user (`isReferencingSelf`: session name equals the username and any Basic-auth username matches too), otherwise it returns 403 `Insufficient privileges`. `getUser(username)` reads the `_users` and `user-settings` docs, fetches the user's place and contact via `facility.list([user])`, and builds the result with `mapUser`, a helper extracted from `mapUsers`.

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

Added cases to the existing specs: the controller's `get single user` block (api/tests/mocha/controllers/users.spec.js — including self-access with and without Basic auth, refusal when not self, and conflicting Basic auth vs session cookie), the shared library's `getUser` block (shared-libs/user-management/test/unit/users.spec.js — missing username, missing `_users` or `user-settings` doc), and `GET api/v2/users/{username}` integration cases in tests/integration/api/controllers/users.spec.js (with and without `can_view_users`, self-retrieval, unknown user).

## Related Issues

- #8986: "/api/v2/users look up data for single user" — this draft's issue
- #8877: "/api/v2/users look up users by `facility_id` and/or `contact_id`" — the issue #8986 was split off from; shipped by PR #8928
- PR medic/cht-docs#1350: "feat: add API docs for getting user by username" — documents the new endpoint

## Domain Rationale

**Fit:** strong

User management (users, their roles and facility associations) is canonically part of the authentication domain in CHT; this PR adds a user-retrieval API endpoint backed by the user-management shared library, and its access rule (`can_view_users` or the user themselves) is an authorization decision, so it is an auth-domain concern rather than an external-system integration.

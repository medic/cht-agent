---
id: cht-core-9065
category: bug
domain: authentication
domainFit: strong
issueNumber: 9065
issueUrl: https://github.com/medic/cht-core/issues/9065
title: Block offline users from accessing the api/v1/person REST endpoint
lastUpdated: '2026-06-23'
summary: The api/v1/person REST endpoint was reachable by offline users (limited DB-access users), which it should not be. The fix adds an authorization check so only online users with full DB access can call the endpoint.
services:
  - api
techStack:
  - javascript
  - typescript
  - nodejs
  - couchdb
  - mocha
tags:
  - access-control
  - authorization
  - rest-api
  - offline-users
  - online-users
  - person-endpoint
related_workflows: []
source_pr: medic/cht-core#9205
source_sha: 8ed110d5d452237bf75946896fe19c1d9d3c01f1
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/person.js
  - shared-libs/cht-datasource/src/local/person.ts
concepts:
  - authorization
  - access control
  - online vs offline users
  - full DB access
  - REST endpoint protection
related_issues: []
stale: false
---

## Problem

The api/v1/person REST endpoint could be invoked by offline users (users with restricted/curated CouchDB replication rather than full DB access). This endpoint is intended only for online users, so offline access constituted an access-control gap exposing person data to users who should not reach it via this route.

## Root Cause

The person controller did not verify that the requesting user was an online user (with full DB access) before serving the endpoint, so requests from offline users were not rejected.

## Solution

Added an authorization check in api/src/controllers/person.js so that only online users (full DB access) can call api/v1/person; offline users are blocked. Corresponding handling was adjusted in the cht-datasource local person implementation (shared-libs/cht-datasource/src/local/person.ts).

## Code Patterns

Guard online-only REST endpoints by checking the requesting user's DB-access level (online vs offline) in the controller before serving data — see api/src/controllers/person.js.

## Design Choices

Restricting at the controller/endpoint level (rather than per-document filtering) reflects the online/offline model: offline users replicate a curated local subset and operate against that, so the server-side person endpoint is deliberately reserved for online users with full DB access.

## Related Files

- api/src/controllers/person.js
- api/tests/mocha/controllers/person.spec.js
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/test/local/person.spec.ts
- tests/integration/api/controllers/person.spec.js

## Testing

Updated unit tests for the controller (api/tests/mocha/controllers/person.spec.js) and the datasource (shared-libs/cht-datasource/test/local/person.spec.ts), plus integration tests (tests/integration/api/controllers/person.spec.js) verifying offline users are blocked while online users retain access.

## Related Issues

- #9065: feature request for REST API endpoints to fetch person/contact data; this PR restricts the new person endpoint to online users
- #9194: get-place workflow split off from #9065

## Domain Rationale

**Fit:** strong

The PR's substance is access control: it gates the api/v1/person endpoint to online users (full DB access) and blocks offline users. Per the guidance, permission/role/access-level concerns belong to authentication even when the data served is contact/person data.

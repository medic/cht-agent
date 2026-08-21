---
id: cht-core-10039
category: feature
domain: contacts
domainFit: strong
issueNumber: 10039
issueUrl: https://github.com/medic/cht-core/issues/10039
title: Add remote (HTTP) cht-datasource implementation and API endpoint for updating place contacts
lastUpdated: '2026-08-20'
summary: The cht-datasource library could get/create places and could already update one through the local (direct-DB) implementation, but had no remote (HTTP) path to update. This PR adds the remote update-place implementation plus the backing API controller and route, completing update-place support across the local and remote datasource implementations.
services:
  - api
techStack:
  - typescript
  - javascript
  - couchdb
  - express
tags:
  - cht-datasource
  - place
  - update
  - remote-implementation
  - crud
  - api-controller
  - contact-hierarchy
related_workflows: []
source_pr: medic/cht-core#10173
source_sha: e6158836d6fff6b83d2afbbb2f08dc3122de8e7e
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/place.ts
  - shared-libs/cht-datasource/src/remote/place.ts
  - shared-libs/cht-datasource/src/local/place.ts
  - shared-libs/cht-datasource/src/local/libs/core.ts
  - shared-libs/cht-datasource/src/index.ts
  - api/src/controllers/place.js
  - api/src/routing.js
concepts:
  - cht-datasource local/remote dual-implementation pattern
  - data-access abstraction layer
  - RESTful API endpoint for resource update
  - contact/place hierarchy
  - CRUD operations on place contacts
related_issues: []
stale: false
---

## Problem

The cht-datasource library exposed ways to get and create places, and could already update a place through the local (direct-DB) implementation, but lacked a remote (HTTP-based) implementation for updating a place. Consumers operating against the API over HTTP (rather than with direct database access) had no datasource method to update a place document, and there was no API endpoint to back such an operation.

## Root Cause

Feature gap rather than a defect: the update-place operation had not yet been implemented in the remote datasource (shared-libs/cht-datasource/src/remote/place.ts) nor exposed as an API route/controller (api/src/routing.js, api/src/controllers/place.js). The datasource's local/remote contract was incomplete for the update operation.

## Solution

Added a remote implementation for updating a place in shared-libs/cht-datasource/src/remote/place.ts that issues an HTTP request to the API, wired the corresponding update declaration into the place datasource module (src/place.ts), and surfaced it through src/index.ts. On the server side, added an update-place handler in api/src/controllers/place.js and registered the route in api/src/routing.js. src/local/libs/core.ts only widens `checkFieldWithLineage` to an export. src/local/place.ts (which already had `v1.update` from an earlier PR in the #9835 epic) additionally gains two new local update rules: rejecting a `parent` added to a top-of-hierarchy place, and appending the contact's `_id`/lineage when the original doc has no contact.

## Code Patterns

Follows the established cht-datasource pattern of pairing a local implementation (src/local/place.ts, direct DB access) with a remote implementation (src/remote/place.ts, HTTP to the API) behind a shared interface declared in src/place.ts and re-exported from src/index.ts. New write operations are mirrored by an API controller method (api/src/controllers/place.js) plus a route registration (api/src/routing.js), and each layer gets a parallel spec under test/ and tests/integration/.

## Design Choices

Reuses the existing datasource local/remote dual-implementation architecture instead of introducing a new access path, so update-place behaves consistently whether invoked with direct DB access or over HTTP. Scoped to the single update operation as part of incrementally building out full CRUD for places in the datasource.

## Related Files

- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/remote/place.ts
- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/src/local/libs/core.ts
- shared-libs/cht-datasource/src/index.ts
- api/src/controllers/place.js
- api/src/routing.js
- shared-libs/cht-datasource/test/place.spec.ts
- shared-libs/cht-datasource/test/remote/place.spec.ts
- shared-libs/cht-datasource/test/local/place.spec.ts
- shared-libs/cht-datasource/test/index.spec.ts
- api/tests/mocha/controllers/place.spec.js
- tests/integration/api/controllers/place.spec.js
- tests/integration/shared-libs/cht-datasource/place.spec.js

## Testing

Extensive unit and integration coverage updated — all seven spec files modified, none added: datasource module spec (test/place.spec.ts), remote impl spec (test/remote/place.spec.ts), local impl spec (test/local/place.spec.ts), and public index spec (test/index.spec.ts); API controller unit tests (api/tests/mocha/controllers/place.spec.js); plus end-to-end integration tests for the API controller (tests/integration/api/controllers/place.spec.js) and the datasource (tests/integration/shared-libs/cht-datasource/place.spec.js). The PR checklist marks 'Tested' as done.

## Related Issues

- #10039: add remote implementation for update place (parent feature tracking datasource update-place support)

## Domain Rationale

**Fit:** strong

The PR adds remote update capability for 'place' documents, which in CHT's data model are contacts forming the place hierarchy, so this is core contact management. The local/remote split here is a data-access abstraction (HTTP vs direct DB), not replication, so it is not data-sync.

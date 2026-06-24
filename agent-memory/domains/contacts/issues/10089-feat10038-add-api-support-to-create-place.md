---
id: cht-core-10089
category: feature
domain: contacts
domainFit: strong
issueNumber: 10089
issueUrl: https://github.com/medic/cht-core/issues/10089
title: Add cht-datasource and REST API support to create place contacts
lastUpdated: '2026-06-22'
summary: The cht-datasource library and API previously exposed only read operations for places; this PR adds a createPlace capability across the local and remote datasource adapters and a new API controller/route to create place contacts programmatically.
services:
  - api
techStack:
  - typescript
  - javascript
  - couchdb
  - express
  - mocha
tags:
  - place-creation
  - cht-datasource
  - rest-api
  - contact-hierarchy
  - data-access-layer
  - crud
related_workflows:
  - contact-creation
source_pr: medic/cht-core#10089
source_sha: 98a687a80ba0b9b2abc5adfb15399bb634e63bde
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/place.js
  - api/src/routing.js
  - shared-libs/cht-datasource/src/place.ts
  - shared-libs/cht-datasource/src/local/place.ts
  - shared-libs/cht-datasource/src/remote/place.ts
  - shared-libs/cht-datasource/src/index.ts
  - shared-libs/cht-datasource/src/libs/parameter-validators.ts
concepts:
  - data access layer (cht-datasource)
  - local/remote adapter pattern
  - REST API controller
  - parameter validation
  - contact hierarchy (places)
  - versioned datasource API (v1)
related_issues: []
stale: false
---

## Problem

The cht-datasource library and the API exposed only retrieval operations for places (e.g. get / getWithLineage); there was no programmatic way to create a place through the datasource library or a REST endpoint, blocking services and external/integration clients from creating place contacts via the API.

## Root Cause

Not a defect but a missing capability: the place module in cht-datasource (src/place.ts) and its local/remote adapters implemented only read paths, and no corresponding create function, API controller, or route existed.

## Solution

Adds a createPlace operation to the cht-datasource place module (src/place.ts) with matching local (src/local/place.ts) and remote (src/remote/place.ts) adapter implementations, exports it via src/index.ts, adds input validation in src/libs/parameter-validators.ts, and exposes it through a new api/src/controllers/place.js controller registered in api/src/routing.js. Built on prerequisite PR #10065.

## Code Patterns

Follows the cht-datasource local/remote adapter pattern: src/place.ts declares the versioned public surface (v1.createPlace), src/local/place.ts implements the in-app CouchDB path, src/remote/place.ts implements the HTTP path; api/src/controllers/place.js adapts HTTP request/response to the datasource call and is wired up in api/src/routing.js. Input validation is centralized in shared-libs/cht-datasource/src/libs/parameter-validators.ts.

## Design Choices

Extends the existing datasource adapter architecture (local + remote) rather than adding a bespoke create path, keeping place creation consistent with existing place/person read operations across in-app and remote contexts. Sequenced after prerequisite PR #10065 which provided the foundational work.

## Related Files

- api/src/controllers/place.js
- api/src/routing.js
- api/tests/mocha/controllers/place.spec.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/remote/place.ts
- shared-libs/cht-datasource/test/index.spec.ts
- shared-libs/cht-datasource/test/local/place.spec.ts
- shared-libs/cht-datasource/test/remote/place.spec.ts
- tests/integration/api/controllers/place.spec.js
- tests/integration/shared-libs/cht-datasource/place.spec.js

## Testing

Adds unit tests for the local adapter (test/local/place.spec.ts), remote adapter (test/remote/place.spec.ts) and datasource index (test/index.spec.ts), controller tests (api/tests/mocha/controllers/place.spec.js), and integration tests (tests/integration/api/controllers/place.spec.js, tests/integration/shared-libs/cht-datasource/place.spec.js). The PR description initially flagged integration, remote-adapter and controller tests as TODO, but those test files are present in the merged change set.

## Related Issues

- #10038: feature request to add API support to create a place
- #10065: prerequisite PR providing foundational datasource work this builds on

## Domain Rationale

**Fit:** strong

Places (districts, health centres, clinics) are canonically part of the CHT contact hierarchy, and this PR adds datasource + API support to create place contacts. The work is data-access for a contact type, not replication/sync, so contacts is the squarely correct domain.

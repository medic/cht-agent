---
id: cht-core-10038
category: feature
domain: contacts
domainFit: strong
issueNumber: 10038
issueUrl: https://github.com/medic/cht-core/issues/10038
title: Implement createPlace in the cht-datasource local data context
lastUpdated: '2026-06-22'
summary: The cht-datasource local data context could read places but had no way to create them. This PR implements `createPlace` in the local place module with accompanying unit tests, enabling programmatic place-contact creation through the unified datasource API.
services:
  - api
  - webapp
techStack:
  - typescript
  - couchdb
  - pouchdb
tags:
  - cht-datasource
  - createPlace
  - place
  - contacts
  - local-datasource
  - crud
related_workflows:
  - contact-creation
source_pr: medic/cht-core#10065
source_sha: 169a023557359eb03447872ce841edde38aac4a9
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/place.ts
concepts:
  - local/remote datasource implementation pattern
  - place contact document creation
  - curried data-context functions
related_issues: []
stale: false
---

## Problem

The cht-datasource local data context exposed only read operations for places (get / getWithLineage) and had no create capability, blocking programmatic creation of place-type contacts through the unified datasource API. This is a WIP feature addressing issue #10038.

## Root Cause

Not a bug — the local place module simply had not yet implemented a createPlace function; the write path for places had not been built into the datasource abstraction.

## Solution

Added a `createPlace` function to the local place module that persists a new place document via the LocalDataContext's database services, following the library's curried factory convention, and added unit tests in test/local/place.spec.ts to cover the new behavior.

## Code Patterns

Follows the established cht-datasource local module pattern in shared-libs/cht-datasource/src/local/place.ts: a version-namespaced function (v1.createPlace) curried over a LocalDataContext that writes directly through the medic DB service, mirroring sibling local create implementations.

## Design Choices

Implements the write against the local data context (direct DB access) rather than the remote context (which would POST to the API), keeping the local/remote duality of the datasource intact; uses the same curried-over-DataContext factory style as the rest of the library for consistency.

## Related Files

- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/test/local/place.spec.ts

## Testing

Unit tests added in shared-libs/cht-datasource/test/local/place.spec.ts exercising the new createPlace local implementation.

## Related Issues

- #10038: implement createPlace in cht-datasource

## Domain Rationale

**Fit:** strong

Places are a first-class contact type in CHT's hierarchical data model, so adding createPlace to the datasource is core contact-management functionality. The local/remote split is an internal cht-datasource implementation pattern, not a replication concern, so contacts (not data-sync) is the squarely correct domain.

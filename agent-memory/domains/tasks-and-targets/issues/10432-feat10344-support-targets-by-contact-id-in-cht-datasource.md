---
id: cht-core-10344
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10344
issueUrl: https://github.com/medic/cht-core/issues/10344
title: Add target-interval data source by contact id to cht-datasource with backing REST endpoint for supervision target aggregates
lastUpdated: '2026-06-22'
summary: Target aggregate (supervision) functionality needed to load target-interval docs for all supervised contacts, but cht-datasource and the API had no way to fetch targets by contact id. This adds a target-interval data source with local and remote implementations, a contact-id qualifier, and a backing REST endpoint, consumed by the webapp's target-aggregates service.
services:
  - api
  - webapp
techStack:
  - typescript
  - javascript
  - couchdb
  - angular
  - node.js
tags:
  - targets
  - target-aggregates
  - cht-datasource
  - target-interval
  - supervision
  - rest-api
  - qualifier
related_workflows: []
source_pr: medic/cht-core#10432
source_sha: db9694ef01275c3cecea2752636d299afc38f5f3
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/target-interval.ts
  - shared-libs/cht-datasource/src/local/target-interval.ts
  - shared-libs/cht-datasource/src/remote/target-interval.ts
  - shared-libs/cht-datasource/src/qualifier.ts
  - shared-libs/cht-datasource/src/libs/parameter-validators.ts
  - api/src/controllers/target-interval.js
  - api/src/routing.js
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/services/cht-datasource.service.ts
concepts:
  - cht-datasource local/remote abstraction layer
  - qualifier-based document addressing
  - REST endpoint exposing a datasource
  - target aggregation for supervised contacts
  - target-interval documents
related_issues: []
stale: false
---

## Problem

The target aggregate (supervision) feature needs to load the current reporting period's target-interval docs for all of a supervisor's supervised contacts, but cht-datasource had no way to fetch target-interval docs by contact id and the API exposed no corresponding REST endpoint that online users could call. This blocked aggregating targets across supervised contacts.

## Root Cause

cht-datasource lacked a target-interval data source and a contact-id qualifier, and the API had no target-interval REST route, so target docs could only be reached through existing local/rules-engine paths rather than addressed directly by contact id.

## Solution

Added a target-interval data source to cht-datasource exposing a getter addressed by a contact-id qualifier, with both a local (offline/PouchDB) implementation and a remote (REST) implementation, plus supporting parameter validators and doc helpers. Exposed it through a new api/src/controllers/target-interval.js controller registered in api/src/routing.js, and updated the webapp cht-datasource.service and target-aggregates.service to consume the new datasource.

## Code Patterns

cht-datasource three-file pattern per data type: src/target-interval.ts (public types + getter factory), src/local/target-interval.ts (offline impl), src/remote/target-interval.ts (REST impl), with lookups keyed by a qualifier from src/qualifier.ts and inputs checked by src/libs/parameter-validators.ts. The remote implementation is surfaced as an Express controller (api/src/controllers/target-interval.js) wired into api/src/routing.js, and webapp services call it through cht-datasource.service.ts.

## Design Choices

Implemented in cht-datasource rather than as an ad-hoc API call so offline (PouchDB) and online (REST) callers share one typed interface; a contact-id qualifier keys the lookup so the same datasource serves target aggregation across all supervised contacts and can be called by online users via the new endpoint.

## Related Files

- shared-libs/cht-datasource/src/target-interval.ts
- shared-libs/cht-datasource/src/local/target-interval.ts
- shared-libs/cht-datasource/src/remote/target-interval.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/index.ts
- api/src/controllers/target-interval.js
- api/src/routing.js
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/cht-datasource.service.ts

## Testing

Unit tests added/updated across every cht-datasource layer (target-interval, qualifier, local/libs/doc) and the api controller mocha spec; integration tests for both the api target-interval controller and the cht-datasource target-interval datasource; karma specs for the webapp cht-datasource and target-aggregates services; and an e2e wdio spec (target-aggregates) with aggregates helper-function updates.

## Related Issues

- #10344: Support target aggregates loading target docs for all supervised contacts (closed by this PR)
- #10343: Prerequisite functionality this work depends on

## Domain Rationale

**Fit:** strong

The PR adds the ability to fetch target-interval docs by contact id to power target aggregates (supervision targets) — targets and coverage aggregation are canonical tasks-and-targets functionality. Although implemented in the cht-datasource data-access library plus an API endpoint, the functional purpose is squarely targets, not replication/sync.

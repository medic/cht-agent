---
id: cht-core-10343
category: feature
domain: tasks-and-targets
domainFit: weak
issueNumber: 10343
issueUrl: https://github.com/medic/cht-core/issues/10343
title: Add target intervals (target docs) to cht-datasource with local and remote implementations plus an API controller and route
lastUpdated: '2026-06-22'
summary: Target docs ("target intervals") could only be read through bespoke DB-loading code in the target-aggregates service and analytics.getTargetDocs, with no reusable access path. This PR adds a target-interval module to cht-datasource (local + remote implementations, new qualifier) and a matching API controller/route to expose them.
services:
  - api
techStack:
  - typescript
  - javascript
  - couchdb
  - express
  - mocha
tags:
  - target-intervals
  - target-docs
  - cht-datasource
  - data-access
  - aggregate-targets
  - api-endpoint
  - qualifier
related_workflows: []
source_pr: medic/cht-core#10390
source_sha: 60ca9634fc9abf54fbae7fb4acec843adae8827d
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/target-interval.ts
  - shared-libs/cht-datasource/src/local/target-interval.ts
  - shared-libs/cht-datasource/src/remote/target-interval.ts
  - shared-libs/cht-datasource/src/qualifier.ts
  - api/src/controllers/target-interval.js
concepts:
  - cht-datasource unified data access layer
  - local (direct DB) vs remote (HTTP) datasource implementations
  - qualifier-based querying
  - target documents / target intervals
  - API controller and routing wiring
related_issues: []
stale: false
---

## Problem

cht-datasource exposed no way to read target intervals (target docs). Historical/aggregate target data was loaded via bespoke code in target-aggregates.service.ts and surfaced to targets/tasks/contact-summary via analytics.getTargetDocs, so there was no centralized, reusable, typed access path for target docs.

## Root Cause

The cht-datasource library lacked a target-interval module; target-doc retrieval lived in webapp service code (target-aggregates.service.ts) and the analytics.getTargetDocs helper rather than in the shared data-access layer, preventing reuse across local and remote contexts.

## Solution

Added a target-interval module to cht-datasource following the library's established structure: a top-level target-interval.ts defining the type/accessors, parallel local/target-interval.ts (direct CouchDB access) and remote/target-interval.ts (HTTP) implementations wired into their index.ts barrels and the root src/index.ts, plus a new qualifier in qualifier.ts for selecting intervals. Exposed the remote path via a new api/src/controllers/target-interval.js controller registered in api/src/routing.js.

## Code Patterns

Standard cht-datasource feature shape: define the domain type and getter API in src/<entity>.ts, implement it twice (src/local/<entity>.ts for direct DB access and src/remote/<entity>.ts for the HTTP client), export both from the respective local/remote index.ts and the root index.ts, extend src/qualifier.ts for query parameters, then add a thin api/src/controllers/<entity>.js + a routing.js route to back the remote implementation. Mirror this triad (src + local + remote + qualifier + controller + route) when adding any new datasource entity.

## Design Choices

Reused the existing cht-datasource local/remote split and qualifier convention instead of extending the bespoke target-aggregates DB-loading code, giving a consistent, typed, reusable access layer that works in both offline (local) and online (remote/API) contexts and centralizes target-doc retrieval for future migration of analytics.getTargetDocs and aggregate-target consumers.

## Related Files

- shared-libs/cht-datasource/src/target-interval.ts
- shared-libs/cht-datasource/src/local/target-interval.ts
- shared-libs/cht-datasource/src/remote/target-interval.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/local/index.ts
- shared-libs/cht-datasource/src/remote/index.ts
- api/src/controllers/target-interval.js
- api/src/routing.js

## Testing

Added mocha unit tests for the new datasource module (test/target-interval.spec.ts, test/local/target-interval.spec.ts, test/remote/target-interval.spec.ts, test/qualifier.spec.ts, test/index.spec.ts) and for the API controller (api/tests/mocha/controllers/target-interval.spec.js), plus end-to-end integration tests (tests/integration/api/controllers/target-interval.spec.js and tests/integration/shared-libs/cht-datasource/target-interval.spec.js).

## Related Issues

- #10343: expose target intervals (target docs) through cht-datasource to replace bespoke target-aggregates DB loading and back analytics.getTargetDocs

## Domain Rationale

**Fit:** weak

All changed files are shared-libs/cht-datasource plus one API controller — data-access-layer work tied to tasks only because the docs fetched are targets; tasks-and-targets is the least-bad home rather than a principled fit.

---
id: cht-core-9295
category: feature
domain: contacts
domainFit: strong
issueNumber: 9295
issueUrl: https://github.com/medic/cht-core/issues/9295
title: Add REST API endpoint for getting people via cht-datasource
lastUpdated: '2026-06-23'
summary: CHT had no dedicated REST API endpoint for programmatically retrieving person (contact) documents. This adds a person module to the cht-datasource shared library (local and remote variants) and exposes it through a new api controller and route that resolves a person by qualifier.
services:
  - api
techStack:
  - typescript
  - javascript
  - nodejs
  - express
  - couchdb
  - mocha
tags:
  - rest-api
  - cht-datasource
  - person
  - api-endpoint
  - data-access
related_workflows: []
source_pr: medic/cht-core#9295
source_sha: 20ee6e5c627b19c1c9a03f25142bc698f85062bf
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/person.js
  - api/src/routing.js
  - api/src/server-utils.js
  - shared-libs/cht-datasource/src/index.ts
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - REST API design
  - cht-datasource abstraction layer
  - local vs remote data access pattern
  - qualifier-based data fetching
  - person/contact data model
related_issues: []
stale: false
---

## Problem

CHT lacked a standardized REST API endpoint for retrieving a person (contact) document by identifier. The cht-datasource library had no person-fetching capability, so neither internal callers nor external consumers had a documented, reusable way to get a person.

## Root Cause

Missing functionality rather than a defect: the cht-datasource library had no person module (local/remote) or qualifier support for people, and the api service had no person controller or registered route.

## Solution

Added a `person` module to cht-datasource exposing a unified interface with two implementations — local/person.ts (direct CouchDB access) and remote/person.ts (HTTP/REST access) — and re-exported it from src/index.ts. Added a qualifier helper (qualifier.ts) for typed person identifiers (e.g., by UUID) and a dedicated error type in libs/error.ts. On the api side, added a person controller (controllers/person.js) and registered a new route in routing.js that resolves the person by qualifier and returns JSON, with error handling wired through server-utils.js.

## Code Patterns

cht-datasource local/remote split: each data type (e.g., src/person.ts) defines a unified interface implemented twice — local/person.ts queries CouchDB directly while remote/person.ts calls the REST API — chosen by context. New API endpoints follow the pattern of adding api/src/controllers/<entity>.js and registering the route in api/src/routing.js, delegating data access to cht-datasource rather than querying the DB inline. Qualifiers (src/qualifier.ts) provide typed, validated identifiers (e.g., byUuid) passed to datasource getters.

## Design Choices

Implemented data access through the cht-datasource abstraction instead of ad-hoc CouchDB queries in the controller, centralizing logic so it is reusable across server-side (local) and client-side (remote) contexts. Used typed qualifiers for identifier handling and a dedicated datasource error type for consistent error semantics across the library and the api layer.

## Related Files

- api/src/controllers/person.js
- api/src/routing.js
- api/src/server-utils.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/libs/error.ts

## Testing

Extensive tests added: api controller unit tests (api/tests/mocha/controllers/person.spec.js); cht-datasource unit tests for the person interface (test/person.spec.ts), local implementation (test/local/person.spec.ts), remote implementation (test/remote/person.spec.ts), and qualifier (test/qualifier.spec.ts); plus an end-to-end integration test exercising the endpoint (tests/integration/api/controllers/person.spec.js). Reviewer m5r acknowledged the integration test and left a minor change request that was resolved before merge.

## Related Issues

- #9241: create API endpoint for getting people

## Domain Rationale

**Fit:** strong

The endpoint retrieves person documents, and persons are a core contact type in CHT, so the subject matter is contact data access (cf. seed: contact lookup → contacts). There is a secondary interoperability dimension (it adds a public REST API surface), but the data domain is unambiguously contacts.

---
id: cht-core-9065
category: feature
domain: contacts
domainFit: strong
issueNumber: 9065
issueUrl: https://github.com/medic/cht-core/issues/9065
title: Add cht-datasource and REST API support for getting a person with lineage by UUID
lastUpdated: '2026-06-23'
summary: There was no way to fetch a person along with their full parent-contact lineage in one call. This PR adds a get-with-lineage capability to cht-datasource (with local and remote bindings) and exposes it through a new person REST API endpoint.
services:
  - api
techStack:
  - typescript
  - javascript
  - couchdb
  - express
  - nodejs
tags:
  - person
  - lineage
  - contacts
  - cht-datasource
  - rest-api
  - uuid
  - data-context
  - hierarchy
related_workflows: []
source_pr: medic/cht-core#9176
source_sha: 8432f5ab3f6d992b170e842ced85879549817b07
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/person.js
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/local/libs/lineage.ts
  - shared-libs/cht-datasource/src/libs/contact.ts
concepts:
  - contact lineage hydration
  - cht-datasource abstraction layer
  - local vs remote data context bindings
  - UUID-based entity retrieval
  - REST API resource endpoint
related_issues: []
stale: false
---

## Problem

Consumers had no API to retrieve a person and their lineage (the ordered chain of parent place/contact documents) in a single request. The cht-datasource library and the REST API lacked any get-person-with-lineage operation, so callers had to fetch the person and then resolve each ancestor separately.

## Root Cause

This is a capability gap rather than a defect: the person module in cht-datasource exposed only basic get-by-UUID, with no lineage-aware variant and no corresponding controller route in the api service.

## Solution

Added a getWithLineage operation to cht-datasource's person module backed by both local (CouchDB-direct) and remote (HTTP) data-context implementations, with shared lineage-resolution logic factored into local/libs/lineage.ts and contact helpers in libs/contact.ts. The api person controller was extended to expose the new operation as a REST endpoint, returning the person hydrated with its parent hierarchy.

## Code Patterns

Datasource feature pattern: declare the public operation in src/person.ts, implement parallel local (src/local/person.ts) and remote (src/remote/person.ts) bindings against a shared data-context, and reuse cross-cutting helpers (src/local/libs/lineage.ts, src/libs/contact.ts, src/libs/doc.ts). The api/src/controllers/person.js controller delegates to the datasource rather than embedding query logic. Reviewers flagged this as an exemplary template for future API additions.

## Design Choices

Built on the existing cht-datasource local/remote abstraction so the same operation works whether resolved directly against CouchDB or over HTTP, keeping lineage-hydration logic in one shared helper instead of duplicating it per binding. Exposed via the generic person REST resource to keep the API surface consistent.

## Related Files

- api/src/controllers/person.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/local/libs/lineage.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/libs/contact.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/libs/doc.ts
- shared-libs/cht-datasource/src/remote/libs/data-context.ts

## Testing

Comprehensive test coverage added/updated across layers: cht-datasource unit specs (test/person.spec.ts, test/local/person.spec.ts, test/remote/person.spec.ts, test/local/libs/lineage.spec.ts, test/local/libs/doc.spec.ts, test/libs/contact.spec.ts, test/libs/core.spec.ts, test/index.spec.ts, test/remote/libs/data-context.spec.ts), api controller mocha tests (api/tests/mocha/controllers/person.spec.js), and end-to-end integration tests against the REST endpoint (tests/integration/api/controllers/person.spec.js).

## Related Issues

- #9065: Add API support for getting a person with lineage by UUID
- #9090: Initial code PR for cht-datasource person/lineage support
- cht-docs#1422: Documentation for the get-person-with-lineage API

## Domain Rationale

**Fit:** strong

The PR adds retrieval of a person (a contact) together with its lineage — the chain of parent contacts in the place hierarchy — which is core contact lookup and management. The cht-datasource library and REST endpoint are just the delivery mechanism, not the subject.

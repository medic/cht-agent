---
id: cht-core-9586
category: feature
domain: contacts
domainFit: strong
issueNumber: 9586
issueUrl: https://github.com/medic/cht-core/issues/9586
title: Implement freetext search for contacts and reports in the cht-datasource shared library
lastUpdated: '2026-06-22'
summary: cht-datasource (the typed read-access library) could only fetch records by identifier and had no freetext search capability. This PR adds a freetext qualifier plus search functions for contacts (persons/places) and reports across both local (CouchDB view-backed) and remote (API-backed) data contexts, and exposes them via new API controller endpoints.
services:
  - api
techStack:
  - typescript
  - javascript
  - nodejs
  - couchdb
  - mocha
tags:
  - freetext-search
  - cht-datasource
  - search
  - contacts
  - reports
  - qualifier
  - data-access-layer
related_workflows: []
source_pr: medic/cht-core#9625
source_sha: 5c1f9ba4a149041dd2a16e58420546731cd27b25
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/qualifier.ts
  - shared-libs/cht-datasource/src/contact.ts
  - shared-libs/cht-datasource/src/report.ts
  - shared-libs/cht-datasource/src/local/contact.ts
  - shared-libs/cht-datasource/src/remote/contact.ts
  - shared-libs/cht-datasource/src/libs/parameter-validators.ts
  - api/src/controllers/contact.js
  - api/src/controllers/report.js
concepts:
  - freetext search
  - qualifiers
  - local vs remote data-context abstraction
  - shared read-access library
  - parameter validation
  - paginated retrieval
related_issues: []
stale: false
---

## Problem

The cht-datasource library only supported fetching records by UUID/identifier and provided no way to perform freetext search over contacts (persons/places) or reports. Consumers needing search had to rely on legacy/ad-hoc search code instead of the single typed read interface cht-datasource is meant to provide.

## Root Cause

cht-datasource was built up incrementally and lacked a freetext qualifier, the corresponding local (CouchDB/PouchDB view-backed) and remote (API-backed) search implementations, validators for the freetext parameter, and API controller endpoints exposing the operation.

## Solution

Added a freetext qualifier (qualifier.ts) validated in parameter-validators.ts, and implemented search/getIds functions for contact, person, place, and report in both src/local/* (view-backed) and src/remote/* (HTTP-backed) variants, dispatched through the data-context abstraction. New endpoints were added to the api contact/person/place/report controllers and wired into routing.js.

## Code Patterns

Qualifier + dual local/remote implementation pattern: qualifier.ts defines the byFreetext qualifier, parameter-validators.ts enforces it, each entity module (contact.ts, report.ts) delegates to local/*.ts (CouchDB view-backed) or remote/*.ts (API-backed) via libs/data-context.ts; api/src/controllers/*.js thinly call into the datasource. Mirrors the pre-existing get-by-id structure for consistency.

## Design Choices

Search logic was centralized in cht-datasource so api (and other consumers) share one typed read interface rather than duplicating query code, reusing the established local/remote data-context split. Reviewers (jkuester) specifically pushed to align the new search with the existing CHT search code paths rather than reinventing query semantics.

## Related Files

- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/src/contact.ts
- shared-libs/cht-datasource/src/report.ts
- shared-libs/cht-datasource/src/local/contact.ts
- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/remote/contact.ts
- shared-libs/cht-datasource/src/remote/report.ts
- api/src/controllers/contact.js
- api/src/controllers/report.js
- api/src/routing.js

## Testing

Extensive unit tests were added/updated across cht-datasource (test/*.spec.ts for contact, person, place, report, qualifier, parameter-validators, plus local/* and libs/* specs) covering both local and remote search paths and qualifier validation, alongside api mocha controller specs (contact.spec.js, person.spec.js, place.spec.js, report.spec.js) for the new endpoints.

## Related Issues

- #9586: implement freetext search in cht datasource

## Domain Rationale

**Fit:** strong

The PR implements freetext search primarily over contacts (persons/places) in the cht-datasource library, matching the seed mapping of contact search to the contacts domain; report search is included as a secondary part of the same feature.

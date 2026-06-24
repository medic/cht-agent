---
id: cht-core-10083
category: feature
domain: contacts
domainFit: strong
issueNumber: 10083
issueUrl: https://github.com/medic/cht-core/issues/10083
title: Add cht-datasource create/update APIs for contacts and reports (local + remote data contexts)
lastUpdated: '2026-06-22'
summary: The cht-datasource library and api only exposed read operations for contacts and reports. This PR adds create and update operations for person, place and report entities across both local (PouchDB) and remote (HTTP) data contexts, with a new shared input-validation flow and corresponding api controller endpoints.
services:
  - api
techStack:
  - typescript
  - javascript
  - nodejs
  - couchdb
  - pouchdb
  - express
tags:
  - contacts
  - reports
  - datasource
  - cht-datasource
  - api
  - create
  - update
  - crud
  - input-validation
related_workflows:
  - contact-creation
  - form-submission
source_pr: medic/cht-core#10083
source_sha: f382785bef793bd415b17fb2d693220089491276
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/contact.ts
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/place.ts
  - shared-libs/cht-datasource/src/report.ts
  - shared-libs/cht-datasource/src/input.ts
  - api/src/controllers/contact.js
  - api/src/controllers/person.js
  - api/src/controllers/place.js
  - api/src/controllers/report.js
  - api/src/routing.js
concepts:
  - datasource abstraction with parallel local vs remote data contexts
  - shared data-access library facade
  - centralised write-input validation and parameter validators
  - CRUD write APIs over CouchDB documents
  - api controller delegation and auth-guarded routing
related_issues: []
stale: false
---

## Problem

The cht-datasource shared library and its api endpoints only supported read/get operations for contacts (person, place) and reports. There was no supported, abstraction-level way to programmatically create or update these documents through the datasource APIs.

## Root Cause

cht-datasource was built read-first: only get/getWithLineage-style read paths existed across its local (PouchDB) and remote (HTTP) data contexts, and the api controllers exposed no create/update routes for person, place or report entities.

## Solution

Added create and update operations to cht-datasource for contacts (person, place) and reports, implemented for both local and remote data contexts; introduced a new input module (input.ts) plus parameter-validators to shape and validate write inputs; and wired new create/update endpoints through the api controllers (contact/person/place/report), routing.js, auth.js and server-utils.js. Reviewer jkuester iterated specifically on the inputs/validation flow before approval.

## Code Patterns

Each entity follows the cht-datasource convention of a public facade (src/<entity>.ts) backed by parallel local (src/local/<entity>.ts, PouchDB) and remote (src/remote/<entity>.ts, HTTP) implementations selected by data-context; write inputs are validated centrally via src/input.ts and src/libs/parameter-validators.ts before reaching the data layer; api controllers (api/src/controllers/<entity>.js) delegate to the datasource and are guarded by api/src/auth.js.

## Design Choices

Reused the existing local/remote data-context split rather than adding a separate write path, keeping read and write symmetric across offline (PouchDB) and server (HTTP) usage. Centralised write-input handling in a dedicated input.ts plus parameter-validators (refined during review) instead of validating ad hoc per controller/entity, so validation is shared across person/place/report and both data contexts.

## Related Files

- shared-libs/cht-datasource/src/input.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/remote/report.ts
- api/src/controllers/person.js
- api/src/auth.js
- api/src/routing.js

## Testing

Extensive unit tests added/updated: Mocha specs for the api controllers (contact, person, place, report) plus auth, server-utils and settings; and cht-datasource test specs (contact, person, place, report at top-level and under local/, plus index, libs/core, libs/parameter-validators, local/libs/doc and local/libs/lineage). e2e tests were noted as struggling but attributed to pre-existing issues on master, not this change.

## Related Issues

- #9835: add cht datasource APIs for creation and update of contacts and reports

## Domain Rationale

**Fit:** strong

The PR adds create/update datasource APIs primarily for contacts — person, place and contact entities (plus their local/remote implementations) dominate the 68 changed files — which is core contact management. It also extends to report creation/update (forms-and-reports), but contacts is the larger and primary concern, so it remains a principled fit.

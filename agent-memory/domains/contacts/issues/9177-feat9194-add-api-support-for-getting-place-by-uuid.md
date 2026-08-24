---
id: cht-core-9194
category: feature
domain: contacts
domainFit: strong
issueNumber: 9194
issueUrl: https://github.com/medic/cht-core/issues/9194
title: Add cht-datasource and REST API support for getting a place (contact) by UUID, with optional lineage
lastUpdated: '2026-08-20'
summary: 'CHT had no unified datasource or REST API for fetching a place-type contact by UUID — only the person equivalents existed — `Person.v1.get` and `Person.v1.getWithLineage`, from #9065. This PR adds get-place and get-place-with-lineage to cht-datasource plus a GET /api/v1/place/{id} endpoint, and refactors several call sites to use the new datasource functions where the contact type was known.'
services:
  - api
  - sentinel
techStack:
  - typescript
  - javascript
  - nodejs
  - couchdb
  - express
tags:
  - cht-datasource
  - place
  - contacts
  - rest-api
  - lineage
  - refactoring
  - get-by-uuid
related_workflows: []
source_pr: medic/cht-core#9177
source_sha: 282faee191a448bbcff8f67baa8b3fc844ef14dc
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/place.js
  - shared-libs/cht-datasource/src/place.ts
  - shared-libs/cht-datasource/src/local/place.ts
  - shared-libs/cht-datasource/src/remote/place.ts
  - shared-libs/contacts/src/places.js
  - api/src/routing.js
concepts:
  - data access abstraction layer (cht-datasource)
  - local vs remote data context
  - contact hierarchy and lineage
  - REST API endpoint design
  - shared-library data-context pattern
related_issues:
  - cht-core-9065
  - cht-core-8889
stale: false
---

## Problem

There was no clean, tested way to retrieve a place-type contact by UUID through the cht-datasource abstraction or a REST API endpoint — only the person equivalents `Person.v1.get` and `Person.v1.getWithLineage` existed (issue #9065, delivered by PR #9090 — the same work the Related Issues entry below names by its PR number). Across the codebase, place retrieval relied on ad-hoc PouchDB.get calls, frequently depending on its implicit not-found-throwing behavior without explicit handling or tests.

## Root Cause

cht-datasource and the API only exposed person retrieval; place retrieval was never surfaced through the datasource or REST layer, so callers fetched places directly via PouchDB.get with inconsistent type-awareness and error handling.

## Solution

Added the place operations to cht-datasource — src/place.ts already existed from #9176 with only the Place/PlaceWithLineage interfaces, and this PR added the get/getWithLineage operations to it plus new local DB (src/local/place.ts) and remote HTTP (src/remote/place.ts) implementations mirroring the existing person pattern, wired through local/index, remote/index, and the top-level index — exposed a new GET /api/v1/place/{id} endpoint (with ?with_lineage=true) via api/src/controllers/place.js and api/src/routing.js, and refactored multiple call sites (transitions, user-management, shared-libs/contacts, sentinel purging, the extract-person-contacts migration) to use the new datasource functions only where the contact type was known with confidence.

## Code Patterns

cht-datasource local/remote/index pattern: define curried get / getWithLineage functions in shared-libs/cht-datasource/src/place.ts that take a data context, with concrete implementations in src/local/place.ts (direct DB access) and src/remote/place.ts (HTTP to API), registered in the respective index files; the imperative getDatasource(ctx).v1.place.getByUuid / getByUuidWithLineage wrappers live in src/index.ts. Refactor pattern: replace raw PouchDB.get with Place/Person datasource calls only when type is certain — a user's facility is a place, a contact's parent is a place, a user's contact is a person — adding explicit not-found error handling where the old PouchDB.get implicitly threw.

## Design Choices

Mirrored the established get-person datasource structure for consistency. Deliberately limited refactoring to cases where the code could be confident a contact was specifically a person or place (rather than a generic contact, per discussion in #9065), and preferred rolling back risky refactors over deep logic investigations. Added explicit not-found tests/handling only where prior code implicitly relied on PouchDB.get throwing.

## Related Files

- api/src/controllers/place.js
- api/src/routing.js
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/src/remote/place.ts
- shared-libs/cht-datasource/src/index.ts
- shared-libs/contacts/src/places.js
- shared-libs/contacts/src/people.js
- shared-libs/user-management/src/users.js
- shared-libs/transitions/src/transitions/create_user_for_contacts.js
- sentinel/src/lib/purging.js
- api/src/migrations/extract-person-contacts.js

## Testing

Test coverage is five specs added and seventeen updated. Added: the three new cht-datasource place specs (test/place.spec.ts, test/local/place.spec.ts, test/remote/place.spec.ts), the api place controller spec (api/tests/mocha/controllers/place.spec.js), and the integration spec (tests/integration/api/controllers/place.spec.js). Updated: test/index.spec.ts, the person/login/users api controller specs and the extract-person-contacts migration spec, plus shared-libs/contacts (people/places) and transitions (create_user_for_contacts, death_reporting, registration, update_clinics) and user-management users specs. New tests notably cover the not-found error behavior of refactored call sites that previously relied on PouchDB.get throwing but was untested.

## Related Issues

- #9194: Support get-place and get-place-with-lineage via cht-datasource and REST API (closed by this PR)
- #9065: Parent issue that added get-person and get-person-with-lineage
- #8889: "Provide API access for online users" — the open umbrella issue these get-by-uuid endpoints serve; still open
- PR #9090: added the person get-by-uuid datasource and `/api/v1/person/:uuid` endpoint this PR mirrors for places
- PR #9176: "add api support for getting a person with lineage by uuid" — it also created `src/place.ts`, with the `Place`/`PlaceWithLineage` interfaces only; this PR adds the operations to it
- cht-docs#1423: Documentation PR for the new place endpoints

## Domain Rationale

**Fit:** strong

Places are part of the CHT contact hierarchy; the PR adds datasource and REST API support for retrieving place-type contacts by UUID (with optional lineage), which is squarely contact lookup/management. The local/remote split is a data-access abstraction, not replication, so it stays in contacts rather than data-sync.

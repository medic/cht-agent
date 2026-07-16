---
id: cht-core-10036
category: feature
domain: contacts
domainFit: strong
issueNumber: 10036
issueUrl: https://github.com/medic/cht-core/issues/10036
title: Implement createPerson for the local cht-datasource implementation
lastUpdated: '2026-06-22'
summary: The cht-datasource library had no way to create a Person (contact) document through its local implementation. This PR adds the createPerson function to the local datasource plus supporting qualifier logic and unit tests.
services:
  - api
  - webapp
techStack:
  - typescript
  - pouchdb
  - couchdb
tags:
  - cht-datasource
  - create-person
  - person
  - contact-creation
  - data-access
  - local-datasource
  - qualifier
related_workflows:
  - contact-creation
source_pr: medic/cht-core#10056
source_sha: 428111860143735545dd7f8a71134d7417c7f9bd
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - data access layer
  - datasource abstraction
  - local vs remote implementation
  - document creation
  - qualifiers
related_issues: []
stale: false
---

## Problem

The cht-datasource library exposed read-oriented access for Person contacts but had no local-side capability to create a new Person document. Consumers needing to persist a new person via the datasource's local (PouchDB/CouchDB) path had no createPerson function available.

## Root Cause

Feature gap rather than a defect: the local datasource was being built out incrementally and the create operation for the Person entity had not yet been implemented (tracked under #10036).

## Solution

Added a createPerson implementation in the local person module (src/local/person.ts) that builds and persists the Person document through the local datasource path, with accompanying qualifier support in qualifier.ts to validate/qualify the create input. Unit tests cover the new behaviour.

## Code Patterns

Follows the cht-datasource local/remote split — new operations are implemented in src/local/person.ts mirroring the existing local datasource conventions, with input validation/typing routed through qualifier helpers in src/qualifier.ts.

## Design Choices

Implemented as the local-side counterpart within the established datasource abstraction (local vs remote), keeping create logic alongside existing Person operations rather than in a separate module; marked WIP and built incrementally against issue #10036.

## Related Files

- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/test/local/person.spec.ts
- shared-libs/cht-datasource/test/qualifier.spec.ts

## Testing

Unit tests added/updated for the new createPerson local behaviour (test/local/person.spec.ts) and for the qualifier changes (test/qualifier.spec.ts); the PR checklist marks unit testing as done. Reviewer noted coverage can be inspected via the nyc.config.js html reporter.

## Related Issues

- #10036: Implement createPerson across the cht-datasource (parent issue for create support)

## Domain Rationale

**Fit:** strong

A Person document is a CHT contact, so adding createPerson to the cht-datasource is fundamentally contact creation/management — squarely the contacts domain rather than the data-layer 'local' label suggesting data-sync.

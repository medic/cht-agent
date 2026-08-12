---
id: cht-core-10038
category: feature
domain: contacts
domainFit: strong
issueNumber: 10038
issueUrl: https://github.com/medic/cht-core/issues/10038
title: Add PlaceQualifier type and related validation methods to cht-datasource
lastUpdated: '2026-08-11'
summary: The cht-datasource shared library lacked a dedicated qualifier for identifying place contacts. This PR adds a PlaceQualifier type plus related validation/type-guard methods to qualifier.ts (WIP).
services:
  - api
  - webapp
techStack:
  - typescript
tags:
  - place-qualifier
  - cht-datasource
  - data-access
  - validation
  - type-guard
  - places
related_workflows: []
source_pr: medic/cht-core#10057
source_prs:
  - "medic/cht-core#10057"
  - "medic/cht-core#10065"
  - "medic/cht-core#10089"
  - "medic/cht-core#10108"
  - "medic/cht-core#10124"
source_sha: e0ecefed49ee7dad905c6af9ee243f5fbff2ab03
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - qualifier pattern
  - type guards / runtime validation
  - data access layer
  - place contacts
related_issues: []
stale: false
---

> **Domain note.** This draft is a `data-access` candidate: its anchor PR extends the
> cht-datasource library itself rather than a contacts feature. It stays in `contacts`
> until the taxonomy lands — `data-access` is not yet a valid `domain` value in
> `agent-memory/schema.json` (PR #152 adds it and is unmerged), and relocating a draft
> before #135 adds union selection would drop it from `contacts` retrieval entirely.
> Re-key to `domain: data-access` + `secondaryDomains: [contacts]` in that coordinated pass.

## Problem

The cht-datasource data-access library provided qualifiers for other entity types but had no dedicated PlaceQualifier, so callers could not cleanly qualify/identify place contacts or validate place-specific identifiers through the unified datasource API.

Beyond the qualifier gap, the library exposed only read operations for places (get / getWithLineage) with no create path (PR #10065, PR #10089), no REST endpoint to create place contacts programmatically (PR #10089), no `parent`-field validation in the local place input qualifier (PR #10108), and — on create — stored the `parent`/`contact` fields as plain string IDs rather than the dehydrated nested lineage structure the rest of CHT relies on, with no check that the parent's contact_type was an allowed parent (PR #10124).

## Root Cause

Not a defect — a capability gap: the qualifier surface in shared-libs/cht-datasource/src/qualifier.ts did not yet model places, leaving the place-contact data-access API incomplete. The broader place-creation write path was likewise unbuilt: the place module and its local/remote adapters implemented only read functions (PR #10065, PR #10089), the local place input qualifier omitted a `parent`-field check (PR #10108), and the create/input path wrote only the parent/contact id string — never fetching the referenced parent, checking its contact_type, or constructing a nested lineage object (PR #10124).

## Solution

Added a PlaceQualifier type/interface and related methods (construction plus validation/type-guard helpers) to qualifier.ts, following the library's existing qualifier conventions. Landed as a WIP step toward issue #10038.

Subsequent PRs completed the place-creation feature:
- Implemented `createPlace` in the local place module (`v1.createPlace` curried over the LocalDataContext, writing through the medic DB service) (PR #10065).
- Added `createPlace` to the public place module (`src/place.ts`) with matching local and remote adapter implementations, exported via `src/index.ts`, input validation in `src/libs/parameter-validators.ts`, and a new `api/src/controllers/place.js` controller registered in `api/src/routing.js`, built on prerequisite PR #10065 (PR #10089).
- Extended the local place input qualifier to validate the `parent` field so places cannot be qualified without a valid parent reference (PR #10108).
- On create, fetch the referenced parent contact, validate that its contact_type is among the allowed `parents` configured for the new contact's contact_type, and store the `parent`/`contact` field as a dehydrated/minified nested lineage object (`{_id, parent: {_id, parent: ...}}`) instead of a bare string; centralized in `src/input.ts` and reused by local person/place/report creation (place/report `contact` storage needs no parent-type validation) (PR #10124).

## Code Patterns

Follows the established qualifier convention in shared-libs/cht-datasource/src/qualifier.ts (typed qualifier + isXxxQualifier-style validation/type guard), mirroring existing qualifiers (e.g. UUID/contact-type qualifiers) for consistency across the datasource API.

- Local/remote adapter pattern: `src/place.ts` declares the versioned public surface (`v1.createPlace`), `src/local/place.ts` implements the in-app CouchDB path, `src/remote/place.ts` implements the HTTP path; `api/src/controllers/place.js` adapts HTTP request/response to the datasource call and is wired up in `api/src/routing.js`, with input validation centralized in `src/libs/parameter-validators.ts` (PR #10089). Local write follows the curried-factory convention, writing directly through the medic DB service (PR #10065).
- Field validation in the local place input qualifier: extend the existing qualifier validation in `src/local/place.ts` to assert the `parent` field, mirrored by unit tests (PR #10108).
- Centralized parent fetch + contact_type-vs-allowed-parents validation and dehydrated-lineage construction in `src/input.ts`, reused by `local/person.ts`, `local/place.ts`, and `local/report.ts` so person/place/report creation share one lineage-storage path (PR #10124).

## Design Choices

Reuses the existing qualifier abstraction and validation/type-guard idioms already present in cht-datasource rather than introducing a new shape, keeping the data-access surface uniform across entity types.

- Extends the existing local + remote datasource adapter architecture rather than adding a bespoke create path, keeping place creation consistent with existing place/person read operations (PR #10089).
- Enforces parent validation at the cht-datasource local provider layer (input qualifier) so hierarchy integrity is checked where place documents are accessed, rather than at each call site (PR #10108).
- Persists the minified/dehydrated lineage (nested id chain) rather than a bare string id or the full parent documents — matching how CHT contact docs natively encode hierarchy, enabling offline lineage traversal without extra lookups while keeping document size small; validating the parent's contact_type against configured allowed parents prevents construction of invalid hierarchies at write time (PR #10124).

## Related Files

- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/test/qualifier.spec.ts
- shared-libs/cht-datasource/src/local/place.ts (PR #10065, #10108, #10124)
- shared-libs/cht-datasource/test/local/place.spec.ts (PR #10065, #10108, #10124)
- shared-libs/cht-datasource/src/place.ts (PR #10089)
- shared-libs/cht-datasource/src/remote/place.ts (PR #10089)
- shared-libs/cht-datasource/src/index.ts (PR #10089)
- shared-libs/cht-datasource/src/libs/parameter-validators.ts (PR #10089)
- api/src/controllers/place.js (PR #10089)
- api/src/routing.js (PR #10089)
- api/tests/mocha/controllers/place.spec.js (PR #10089)
- shared-libs/cht-datasource/test/remote/place.spec.ts (PR #10089)
- shared-libs/cht-datasource/test/index.spec.ts (PR #10089)
- tests/integration/api/controllers/place.spec.js (PR #10089, #10124)
- tests/integration/shared-libs/cht-datasource/place.spec.js (PR #10089, #10124)
- shared-libs/cht-datasource/src/input.ts (PR #10124)
- shared-libs/cht-datasource/src/local/person.ts (PR #10124)
- shared-libs/cht-datasource/src/local/report.ts (PR #10124)
- shared-libs/cht-datasource/test/input.spec.ts (PR #10124)
- shared-libs/cht-datasource/test/local/person.spec.ts (PR #10124)
- shared-libs/cht-datasource/test/local/report.spec.ts (PR #10124)
- shared-libs/cht-datasource/test/remote/report.spec.ts (PR #10124)
- api/tests/mocha/controllers/report.spec.js (PR #10124)
- tests/integration/api/controllers/person.spec.js (PR #10124)
- tests/integration/api/controllers/report.spec.js (PR #10124)
- tests/integration/shared-libs/cht-datasource/person.spec.js (PR #10124)
- tests/integration/shared-libs/cht-datasource/report.spec.js (PR #10124)

## Testing

Unit tests for qualifier behavior in shared-libs/cht-datasource/test/qualifier.spec.ts; further qualifier coverage landed with the follow-up work rather than here. (PR #10056 is a different change — it implements `createPerson` for the local data context.)

- Unit tests for the new local createPlace implementation in test/local/place.spec.ts (PR #10065).
- Unit tests for the remote adapter (test/remote/place.spec.ts) and datasource index (test/index.spec.ts), controller tests (api/tests/mocha/controllers/place.spec.js), and integration tests (tests/integration/api/controllers/place.spec.js, tests/integration/shared-libs/cht-datasource/place.spec.js) (PR #10089).
- Unit tests updated for the parent-field checks in the local place qualifier (test/local/place.spec.ts) (PR #10108).
- Unit tests for the dehydrated-lineage path (input.spec.ts plus local person/place/report specs and remote report spec), a mocha controller test (api/tests/mocha/controllers/report.spec.js), and integration tests for person/place/report across api controllers and cht-datasource (PR #10124).

## Related Issues

- #10038: parent issue — add PlaceQualifier and related validations
- PR #10056: implements `createPerson` for the local (PouchDB) data context
- PR #10065: implements createPlace in the local data context
- PR #10089: adds datasource local/remote + REST API support to create places (built on PR #10065)
- PR #10108: adds parent-field validation to the local place input qualifier
- PR #10124: stores parent/contact as a dehydrated lineage object with allowed-parent validation

## Domain Rationale

**Fit:** strong

Places are a first-class contact type in the CHT contact hierarchy (districts, health facilities, etc.), and a PlaceQualifier is the abstraction used to identify/look up place contacts in the data-access layer — squarely contact lookup/management tooling.

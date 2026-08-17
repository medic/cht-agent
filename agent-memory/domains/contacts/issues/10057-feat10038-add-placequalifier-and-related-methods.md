---
id: cht-core-10038
category: feature
domain: contacts
domainFit: strong
issueNumber: 10038
issueUrl: https://github.com/medic/cht-core/issues/10038
title: Add PlaceQualifier type and related validation methods to cht-datasource
lastUpdated: '2026-08-12'
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
stale: true
---

> **Domain note.** This draft is a `data-access` candidate: its anchor PR extends the
> cht-datasource library itself, so under the proposed taxonomy its primary domain would
> be `data-access` with `contacts` secondary. Among the nine domains that exist today
> `contacts` is still the closest fit, which is what the Domain Rationale below argues —
> the two statements are about different taxonomies, not in conflict. It stays in
> `contacts` until the new one lands — `data-access` is not yet a valid `domain` value in
> `agent-memory/schema.json` (PR #152 adds it and is unmerged), and relocating a draft
> before #135 adds union selection would drop it from `contacts` retrieval entirely.
> Re-key to `domain: data-access` + `secondaryDomains: [contacts]` in that coordinated pass.

> **Drift note (verified 2026-08-12).** None of this draft's five source PRs is an ancestor of
> `origin/master`; the work reached master only through the epic squash #10083 (`f382785be`,
> 2026-03-10), after a rename pass. On master `PlaceQualifier`, `byPlaceQualifier` and
> `isPlaceQualifier` no longer exist anywhere in the tree — they were replaced by `PlaceInput`
> in `src/input.ts` (#10094) — `v1.createPlace` is now `v1.create`, master's `src/input.ts` is
> types-only (zero runtime declarations), and the create-time parent-fetch /
> contact_type-check / lineage-shaping logic lives in `src/local/libs/lineage.ts`
> on master, as `assertHasValidParentType` and `minifyDoc` — both master-only.
> The prose below deliberately describes the state at each cited PR, not master's
> shape; hence `stale: true`. Read every present-tense sentence below as scoped to
> its cited PR.

## Problem

The cht-datasource data-access library provided qualifiers for other entity types but had no dedicated PlaceQualifier, so callers could not cleanly qualify/identify place contacts or validate place-specific identifiers through the unified datasource API.

Beyond the qualifier gap, the library exposed only read operations for places (get / getWithLineage / getPage / getAll) with no create path (PR #10065, PR #10089), no cht-datasource-backed create endpoint — the legacy `POST /api/v1/places` route existed but went through `shared-libs/contacts/src/places.js`, bypassing the datasource (PR #10089) — no `parent`-field validation on the local place create input (PR #10108), and — on create — stored the `parent`/`contact` fields as plain string IDs rather than the dehydrated nested lineage structure the rest of CHT relies on, with no check that the parent's contact_type was an allowed parent (PR #10124).

## Root Cause

Not a defect — a capability gap: the qualifier surface in shared-libs/cht-datasource/src/qualifier.ts did not yet model places, leaving the place-contact data-access API incomplete. The broader place-creation write path was likewise unbuilt: the place module and its local/remote adapters implemented only read functions (PR #10065, PR #10089), the local place create input path omitted a `parent`-field check (PR #10108), and the create/input path wrote only the parent/contact id string — never fetching the referenced parent, checking its contact_type, or constructing a nested lineage object (PR #10124).

## Solution

Added a PlaceQualifier type/interface and related methods (construction plus validation/type-guard helpers) to qualifier.ts, following the library's existing qualifier conventions. Landed as a WIP step toward issue #10038.

Subsequent PRs completed the place-creation feature:
- Implemented `createPlace` in the local place module (`v1.createPlace` curried over the LocalDataContext, writing through the medic DB service) (PR #10065).
- Added `createPlace` to the public place module (`src/place.ts`) with the remote adapter implementation (`src/remote/place.ts`), wired to the local implementation already landed in #10065, exported via `src/index.ts`, input validation in `src/libs/parameter-validators.ts`, and a `createPlace` handler on `api/src/controllers/place.js` registered in `api/src/routing.js`, built on prerequisite PR #10065 (PR #10089).
- Extended the local place create path to validate the `parent` field against the contact type's configured `parents`: types that declare a `parents` array must supply a `parent` (and it must be listed there), while types that do not declare `parents` — i.e. types at the top of the hierarchy — must not supply one at all. Legacy `type: 'place'` input skips the check entirely, so this is not a blanket "places always require a parent" rule (PR #10108).
- On create, fetch the referenced parent contact and check its `contact_type` against the parent types the new contact's own type permits — that allow-list is the `parents` array on the contact-type config in app settings, read through `shared-libs/contact-types-utils`, not a field of the datasource. The `parent`/`contact` field is then stored as a dehydrated/minified nested lineage object (`{_id, parent: {_id, parent: ...}}`) instead of a bare string. The fetch, the check and the shaping are implemented as per-module helpers duplicated inside `createPerson` (`src/local/person.ts`) and `createPlace` (`src/local/place.ts`), with `contact`-only shaping in `createReport` (`src/local/report.ts`) — the report path does no parent-type validation, and none of the three modules shares a helper; all three import only a *type* (`PersonInput`/`PlaceInput`/`ReportInput`) from `src/input.ts`. #10124's only change to `src/input.ts` — a file added earlier by #10094, not by #10124 — is to make `contact: string` a required field on `ReportInput` (+6/-1). Place/report `contact` storage needs no parent-type validation (PR #10124).

## Code Patterns

Follows the established qualifier convention in shared-libs/cht-datasource/src/qualifier.ts (typed qualifier + isXxxQualifier-style validation/type guard), mirroring existing qualifiers (e.g. UUID/contact-type qualifiers) for consistency across the datasource API.

- Local/remote adapter pattern: `src/place.ts` declares the versioned public surface (`v1.createPlace`), `src/local/place.ts` implements the in-app CouchDB path, `src/remote/place.ts` implements the HTTP path; `api/src/controllers/place.js` adapts HTTP request/response to the datasource call and is wired up in `api/src/routing.js`, with input validation centralized in `src/libs/parameter-validators.ts` (PR #10089). Local write follows the curried-factory convention, writing directly through the medic DB service (PR #10065).
- Field validation on the local place create input: `createPlace` in `src/local/place.ts` gains a `parent` check against the contact type's configured `parents`, mirrored by unit tests. This is not a qualifier-module change — by #10108 the parameter had already been renamed `qualifier` → `input` by #10094, and there was no prior qualifier validation in `src/local/place.ts` to extend. As written in #10108 the check compares the supplied parent *id* against the allowed parent *types*, so it does not yet verify hierarchy integrity; #10124 replaces it with a parent-doc fetch and a `contact_type` comparison (PR #10108).
- Per-module parent fetch + contact_type-vs-allowed-parents validation and dehydrated-lineage construction, added in parallel as closures inside `createPerson` (`local/person.ts`) and `createPlace` (`local/place.ts`), with `contact`-only shaping in `createReport` (`local/report.ts`) — deliberately noted because it is *not* shared code: there is no single lineage-storage path at this point. `src/input.ts` does hold runtime field validators at this commit (`validatePersonInput`/`validatePlaceInput`/`validateReportInput`), but the three local modules import only the corresponding *type* from it and none of the parent-fetch, contact_type-check or lineage-shaping logic lives there (PR #10124).

## Design Choices

Reuses the existing qualifier abstraction and validation/type-guard idioms already present in cht-datasource rather than introducing a new shape, keeping the data-access surface uniform across entity types.

- Extends the existing local + remote datasource adapter architecture rather than adding a bespoke create path, keeping place creation consistent with existing place/person read operations (PR #10089).
- Enforces parent validation at the cht-datasource local provider layer, on the create input inside `createPlace`, so the constraint sits where place documents are written rather than at each call site (PR #10108).
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
- shared-libs/cht-datasource/src/input.ts (PR #10124 — modified only; the file was added by PR #10094)
- shared-libs/cht-datasource/src/local/person.ts (PR #10124)
- shared-libs/cht-datasource/src/local/report.ts (PR #10124)
- shared-libs/cht-datasource/test/input.spec.ts (PR #10124 — modified only; the file was added by PR #10094)
- shared-libs/cht-datasource/test/local/person.spec.ts (PR #10124)
- shared-libs/cht-datasource/test/local/report.spec.ts (PR #10124)
- shared-libs/cht-datasource/test/remote/report.spec.ts (PR #10124)
- api/tests/mocha/controllers/report.spec.js (PR #10124)
- tests/integration/api/controllers/person.spec.js (PR #10124)
- tests/integration/api/controllers/report.spec.js (PR #10124)
- tests/integration/shared-libs/cht-datasource/person.spec.js (PR #10124)
- tests/integration/shared-libs/cht-datasource/report.spec.js (PR #10124)

## Testing

Unit tests for qualifier behavior in shared-libs/cht-datasource/test/qualifier.spec.ts (+496 lines — this PR carries the bulk of the qualifier coverage); none of this draft's four follow-up source PRs (#10065, #10089, #10108, #10124) touches that file. (PR #10056 is a different change — it implements `createPerson` for the local data context.)

- Unit tests for the new local createPlace implementation in test/local/place.spec.ts (PR #10065).
- Unit tests for the remote adapter (test/remote/place.spec.ts) and datasource index (test/index.spec.ts), controller tests (api/tests/mocha/controllers/place.spec.js), and integration tests (tests/integration/api/controllers/place.spec.js, tests/integration/shared-libs/cht-datasource/place.spec.js) (PR #10089).
- Unit tests updated for the parent-field checks on the local place create input (test/local/place.spec.ts) (PR #10108). Note the happy-path case there creates a `hospital` whose contact type declares no `parents` and passes no `parent` at all, which is why the check is not a blanket parent requirement.
- Unit tests for the dehydrated-lineage path in the local person/place/report specs and the remote report spec, plus test/input.spec.ts coverage for the newly-required `contact` field on `ReportInput` (that spec's changes are about the required field, not lineage), a mocha controller test (api/tests/mocha/controllers/report.spec.js), and integration tests for person/place/report across api controllers and cht-datasource (PR #10124).

## Related Issues

- #10038: parent issue — add PlaceQualifier and related validations
- PR #10056: implements `createPerson` for the local (PouchDB) data context
- PR #10065: implements createPlace in the local data context
- PR #10089: adds datasource public + remote and REST API support to create places (the local adapter came from PR #10065)
- PR #10108: adds parent-field validation to the local place create input
- PR #10124: stores parent/contact as a dehydrated lineage object with allowed-parent validation

## Domain Rationale

**Fit:** strong

Places are a first-class contact type in the CHT contact hierarchy (districts, health facilities, etc.), and a PlaceQualifier is the abstraction used to identify/look up place contacts in the data-access layer — squarely contact lookup/management tooling.

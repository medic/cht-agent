---
id: cht-core-10036
category: feature
domain: contacts
domainFit: strong
issueNumber: 10036
issueUrl: https://github.com/medic/cht-core/issues/10036
title: Add PersonQualifier and related functions to cht-datasource to enable person document creation
lastUpdated: '2026-07-16'
summary: The cht-datasource library lacked a qualifier abstraction for person documents, which is a prerequisite for creating persons via the datasource. This PR adds a `PersonQualifier` type plus related helper/guard functions and unit tests as groundwork for person-creation support.
services:
  - api
  - webapp
techStack:
  - typescript
tags:
  - person-qualifier
  - cht-datasource
  - qualifier
  - data-access
  - person
  - contacts
related_workflows:
  - contact-creation
source_pr: medic/cht-core#10043
source_prs:
  - "medic/cht-core#10043"
  - "medic/cht-core#10056"
  - "medic/cht-core#10061"
source_sha: c734c65d858e5ced94a0e7d7c7f24d729fad818c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - qualifier abstraction
  - data source access layer
  - type guards
  - document identification
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

The cht-datasource library had no `PersonQualifier` or supporting functions to identify and validate person documents, blocking the planned ability to create `person` documents through the datasource API. Building on this, the datasource exposed only read/get operations for persons and had no way to persist a new Person: no `createPerson` in the local implementation (PR #10056), no `createPerson` in the person concept module or remote implementation, and no API route to create a person contact over HTTP (PR #10061).

## Root Cause

Person documents lacked a dedicated qualifier type in cht-datasource's qualifier module; without it there was no consistent, type-safe way to qualify person inputs for downstream create operations. More broadly this was a feature/architectural gap rather than a defect — the datasource was being built out incrementally under #10036, so the local create path (PR #10056) and the concept-module/remote/API create path (PR #10061) had simply not yet been implemented.

## Solution

Added a `PersonQualifier` type and related functions (e.g. construction and guard/validation helpers) to qualifier.ts following the existing qualifier pattern, with accompanying unit tests, as a WIP step toward supporting person document creation.

The feature was delivered in three layers against #10036:
- **Qualifier groundwork (PR #10043):** the `PersonQualifier` type and helper/guard functions described above.
- **Local data layer (PR #10056):** a `createPerson` implementation in the local person module (src/local/person.ts) that builds and persists the Person document through the local (PouchDB/CouchDB) path, with supporting qualifier logic in src/qualifier.ts to validate/qualify the create input.
- **Concept module + API endpoint (PR #10061):** a `createPerson` in the person concept module (src/person.ts) with parameter validation (src/libs/parameter-validators.ts) and the remote implementation (src/remote/person.ts), exported from src/index.ts, then wired to an API controller (api/src/controllers/person.js) and a new route in api/src/routing.js to invoke it over HTTP.

## Code Patterns

Follows the established qualifier pattern in shared-libs/cht-datasource/src/qualifier.ts (type definition plus factory and type-guard functions) used by other qualifiers, keeping person qualification consistent with existing datasource abstractions.

- Local/remote split (PR #10056): new create operations live in src/local/person.ts mirroring existing local datasource conventions, with input validation/typing routed through the qualifier helpers in src/qualifier.ts.
- Concept-module layering (PR #10061): each entity (person, and later place/report) gets a concept module (src/person.ts) exposing a unified interface, a remote implementation (src/remote/person.ts), shared qualifiers (src/qualifier.ts) and parameter validators (src/libs/parameter-validators.ts), and a public export via src/index.ts; the API then thinly wraps the datasource in a controller (api/src/controllers/person.js) registered in api/src/routing.js. New mutations for other entities should replicate this same pattern.

## Design Choices

Reused the existing qualifier abstraction in cht-datasource rather than introducing a bespoke validation path, ensuring consistency with other document qualifiers and a clean foundation for incremental person-creation work.

## Related Files

- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/test/qualifier.spec.ts
- shared-libs/cht-datasource/src/local/person.ts (PR #10056)
- shared-libs/cht-datasource/test/local/person.spec.ts (PR #10056)
- shared-libs/cht-datasource/src/person.ts (PR #10061)
- shared-libs/cht-datasource/src/remote/person.ts (PR #10061)
- shared-libs/cht-datasource/src/index.ts (PR #10061)
- shared-libs/cht-datasource/src/libs/parameter-validators.ts (PR #10061)
- api/src/controllers/person.js (PR #10061)
- api/src/routing.js (PR #10061)
- shared-libs/cht-datasource/test/person.spec.ts (PR #10061)
- shared-libs/cht-datasource/test/remote/person.spec.ts (PR #10061)
- shared-libs/cht-datasource/test/index.spec.ts (PR #10061)

## Testing

Unit tests added in shared-libs/cht-datasource/test/qualifier.spec.ts covering the new PersonQualifier and related functions. The local layer adds unit tests for createPerson in test/local/person.spec.ts (PR #10056). The concept-module/API layer adds unit tests across test/person.spec.ts, test/remote/person.spec.ts, and test/index.spec.ts covering the createPerson interface, qualifier, and parameter validation; API mocha tests and integration/e2e tests were intentionally deferred to a follow-up PR (PR #10061).

## Related Issues

- #10036: integrate PersonQualifier to add support for creating person documents

## Domain Rationale

**Fit:** strong

The PR adds a `PersonQualifier` to the cht-datasource data-access library; person documents are a core CHT contact type, so identifying/qualifying persons squarely belongs to the contacts domain rather than a generic data-layer bucket.

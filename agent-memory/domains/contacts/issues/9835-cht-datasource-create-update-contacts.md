---
id: cht-core-9835
category: feature
domain: contacts
subDomain: cht-datasource
issueNumber: 9835
issueUrl: https://github.com/medic/cht-core/issues/9835
title: Add cht-datasource APIs for creation and update of contacts and reports
lastUpdated: 2026-07-16
summary: Extended cht-datasource with create and update operations for Person, Place, and Report, exposed as both a TypeScript API and REST endpoints, with a major internal refactoring of validation, lineage handling, and auth.
source_prs:
  - "medic/cht-core#10022"
  - "medic/cht-core#10081"
  - "medic/cht-core#10083"
  - "medic/cht-core#10222"
  - "medic/cht-core#10246"
services:
  - api
techStack:
  - typescript
  - couchdb
---

> **Domain note.** This draft is a `data-access` candidate: its anchor PR extends the
> cht-datasource library itself rather than a contacts feature. It stays in `contacts`
> until the taxonomy lands — `data-access` is not yet a valid `domain` value in
> `agent-memory/schema.json` (PR #152 adds it and is unmerged), and relocating a draft
> before #135 adds union selection would drop it from `contacts` retrieval entirely.
> Re-key to `domain: data-access` + `secondaryDomains: [contacts]` in that coordinated pass.

## Problem

The `cht-datasource` shared library only had read-only APIs (fetch by UUID, paginated listing). There were no APIs to create or update Person, Place, or Report documents. All writes went through ad-hoc code paths, bypassing the consistent abstraction layer that `cht-datasource` provides. The read-first design meant only get/getWithLineage-style paths existed across both the local (PouchDB) and remote (HTTP) data contexts, and the api controllers exposed no create/update routes for person, place, or report (PR #10083).

## Root Cause

The initial `cht-datasource` implementation focused on reads. Write operations were scattered across different services without a unified interface. The prior attempt (PR #10083) had duplicated validation logic, inconsistent currying patterns, extra DB round-trips, and semantic misuse of error types.

## Solution

PR #10522 implemented create/update APIs while deeply refactoring the internal architecture. Key changes:
- New `ResourceNotFoundError` for update operations when the target document doesn't exist (replacing misused `InvalidArgumentError`)
- Flattened `isPlace/isPerson/isContact` signatures from curried to direct two-argument form
- `getDocsByIds` now returns `Nullable<Doc>[]` preserving index positions for parallel lookups
- `createDoc/updateDoc` no longer re-fetch the document after writing
- Lineage handling centralized in `local/libs/lineage.ts` with `minifyDoc`, `assertSameParentLineage`, `getUpdatedContact`
- Input types cleaned up — `_id` and `_rev` are `never` on create inputs
- Composable assertion functions in `parameter-validators.ts`
- API controllers simplified with `auth.assertPermissions()` and fixed permission bug (removed spurious read permission requirement on write endpoints)

The initial create/update surface added person/place/report create and update for both local (PouchDB) and remote (HTTP) data contexts, introduced the `input.ts` module plus parameter-validators for centralized write-input validation, and wired new endpoints through the api controllers (contact/person/place/report), `routing.js`, `auth.js`, and `server-utils.js` (PR #10083). A follow-up removed lineage validation checks from the person local data source and the qualifier that were deemed unnecessary during review of PR #10043, simplifying person retrieval (PR #10081). A further follow-up updated the create/update permission checks in the person/place/report controllers to honor the general can_edit permission (PR #10222). On the report side of the issue, the ReportQualifier and a generalized hasField helper laid the groundwork for report create/update (PR #10022), and a fix restored the missing reported_date on created reports (PR #10246).

## Code Patterns

- Create flow: `assertXInput(input)` -> fetch parent/contact in parallel -> validate parent type -> `minifyDoc({...input, parent, contact})` -> `createDoc(minified)`
- Update flow: `isX(settings, updated)` -> fetch original + contact in parallel -> `assertFieldsUnchanged` -> `assertSameParentLineage` -> `minifyDoc(updated)` -> `updateDoc(minified)`
- File: `shared-libs/cht-datasource/src/local/person.ts` — local create/update for persons
- File: `shared-libs/cht-datasource/src/local/place.ts` — local create/update for places
- File: `shared-libs/cht-datasource/src/local/libs/lineage.ts` — centralized lineage validation and minification
- File: `shared-libs/cht-datasource/src/local/libs/doc.ts` — `createDoc`, `updateDoc`, `getDocsByIds` with index-preserving nulls
- File: `shared-libs/cht-datasource/src/libs/parameter-validators.ts` — composable assertion functions
- File: `shared-libs/cht-datasource/src/libs/error.ts` — `ResourceNotFoundError` class
- File: `api/src/controllers/person.js` — simplified controller with `assertPermissions`
- Remote layer uses point-free style: `export const create = postResource('api/v1/person')`
- Each entity exposes a public facade (`src/<entity>.ts`) backed by parallel local (`src/local/<entity>.ts`, PouchDB) and remote (`src/remote/<entity>.ts`, HTTP) implementations selected by data-context; write inputs validated centrally via `src/input.ts` + `src/libs/parameter-validators.ts`; controllers delegate to the datasource guarded by `api/src/auth.js` (PR #10083)
- Qualifier-based data access via `src/qualifier.ts` alongside the local person data source (PR #10081)

## Design Choices

- `ResourceNotFoundError` semantically distinguishes "document not found" from "bad argument" — mapped to HTTP 404 in API and back to the error class in the remote adapter
- Index-preserving `getDocsByIds` enables parallel lookups like `const [parent, contact] = await getDocsByIds([parentId, contactId])`
- Lineage minification reuses `@medic/lineage`'s `minify` function rather than reimplementing dehydration
- Permission fix: create/update endpoints no longer require `can_view_contacts`, only `can_create_people` or `can_edit`
- Auth refactored to `assertPermissions(req, { isOnline, hasAll, hasAny })` pattern for consistency

## Related Files

- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/input.ts
- shared-libs/cht-datasource/src/qualifier.ts (PR #10081)
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/remote/person.ts (PR #10083)
- shared-libs/cht-datasource/src/remote/report.ts (PR #10083)
- shared-libs/cht-datasource/src/local/libs/lineage.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/src/libs/error.ts
- api/src/auth.js
- api/src/controllers/contact.js (PR #10083)
- api/src/controllers/person.js
- api/src/controllers/place.js
- api/src/controllers/report.js (PR #10083)
- api/src/routing.js (PR #10083)
- api/src/server-utils.js

## Testing

- Extensive unit tests across all changed files in `shared-libs/cht-datasource/test/`
- Integration tests for API controllers
- Tests verify both create and update flows for persons, places, and reports
- Tests cover permission validation, lineage validation, and error handling
- Integration tests under `tests/integration/api/controllers/person.spec.js` and `tests/integration/shared-libs/cht-datasource/person.spec.js` updated when lineage checks were removed (PR #10081)

## Related Issues

- #10083: Initial create/update implementation that this PR refactored
- #10081: Removed lineage checks from the person data source and qualifier that were deemed unnecessary
- #10043: PR whose review discussion prompted removing the lineage checks in #10081

---
id: cht-core-9835
category: feature
domain: contacts
subDomain: cht-datasource
issueNumber: 9835
issueUrl: https://github.com/medic/cht-core/issues/9835
title: Add cht-datasource APIs for creation and update of contacts and reports
lastUpdated: 2026-03-16
summary: Extended cht-datasource with create and update operations for Person, Place, and Report, exposed as both a TypeScript API and REST endpoints, with a major internal refactoring of validation, lineage handling, and auth.
services:
  - api
  - shared-libs
techStack:
  - typescript
  - couchdb
---

## Problem

The `cht-datasource` shared library only had read-only APIs (fetch by UUID, paginated listing). There were no APIs to create or update Person, Place, or Report documents. All writes went through ad-hoc code paths, bypassing the consistent abstraction layer that `cht-datasource` provides.

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

## Design Choices

- `ResourceNotFoundError` semantically distinguishes "document not found" from "bad argument" — mapped to HTTP 404 in API and back to the error class in the remote adapter
- Index-preserving `getDocsByIds` enables parallel lookups like `const [parent, contact] = await getDocsByIds([parentId, contactId])`
- Lineage minification reuses `@medic/lineage`'s `minify` function rather than reimplementing dehydration
- Permission fix: create/update endpoints no longer require `can_view_contacts`, only `can_create_people` or `can_edit`
- Auth refactored to `assertPermissions(req, { isOnline, hasAll, hasAny })` pattern for consistency

## Related Files

- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/input.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/local/libs/lineage.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/src/libs/error.ts
- api/src/auth.js
- api/src/controllers/person.js
- api/src/controllers/place.js
- api/src/server-utils.js

## Testing

- Extensive unit tests across all changed files in `shared-libs/cht-datasource/test/`
- Integration tests for API controllers
- Tests verify both create and update flows for persons, places, and reports
- Tests cover permission validation, lineage validation, and error handling

## Related Issues

- #10083: Initial create/update implementation that this PR refactored

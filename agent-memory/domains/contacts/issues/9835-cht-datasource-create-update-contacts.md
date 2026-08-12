---
id: cht-core-9835
category: feature
domain: contacts
subDomain: cht-datasource
issueNumber: 9835
issueUrl: https://github.com/medic/cht-core/issues/9835
title: Add cht-datasource APIs for creation and update of contacts and reports
lastUpdated: '2026-08-12'
summary: Extended cht-datasource with create and update operations for Person, Place, and Report, exposed as both a TypeScript API and REST endpoints, with a major internal refactoring of validation, lineage handling, and auth.
source_prs:
  - "medic/cht-core#10022"
  - "medic/cht-core#10081"
  - "medic/cht-core#10083"
  - "medic/cht-core#10222"
  - "medic/cht-core#10246"
  - "medic/cht-core#10522"
services:
  - api
techStack:
  - typescript
  - couchdb
---

> **Domain note.** This draft is a `data-access` candidate: its anchor PR extends the
> cht-datasource library itself, so under the proposed taxonomy its primary domain would
> be `data-access` with `contacts` secondary. Among the nine domains that exist today
> `contacts` is still the closest fit, which is what this draft's current placement reflects —
> the two statements are about different taxonomies, not in conflict. It stays in
> `contacts` until the new one lands — `data-access` is not yet a valid `domain` value in
> `agent-memory/schema.json` (PR #152 adds it and is unmerged), and relocating a draft
> before #135 adds union selection would drop it from `contacts` retrieval entirely.
> Re-key to `domain: data-access` + `secondaryDomains: [contacts]` in that coordinated pass.

## Problem

The `cht-datasource` shared library only had read-only APIs (fetch by UUID, paginated listing). There were no APIs to create or update Person, Place, or Report documents. All writes went through ad-hoc code paths, bypassing the consistent abstraction layer that `cht-datasource` provides. The read-first design meant only get/getWithLineage-style paths existed across both the local (PouchDB) and remote (HTTP) data contexts, and the api controllers exposed no create/update routes for person, place, or report — this is the state of master that PR #10083 landed against.

## Root Cause

The initial `cht-datasource` implementation focused on reads. Write operations were scattered across different services without a unified interface: validation was repeated at each call site, currying patterns were inconsistent, writes cost extra DB round-trips, and error types were used with the wrong semantics. Those are the conditions the create/update surface below was written to replace.

## Solution

**Provenance — read this before citing any PR below.** `#10083` is the *umbrella* PR that squashed the whole `9835` feature branch onto master (squash `f382785be`, 2026-03-10). Everything described in this draft shipped in that one commit; master had no cht-datasource write support at all beforehand. `#10522` (squash `a89955a9f`, 2026-03-03) is an **ancestor of `#10083`'s head branch**, not a follow-up to it: `#10522` refactored the create/update surface that earlier child PRs had built on the branch, and then the branch landed as `#10083`. Every other PR cited here (`#10022`, `#10081`, `#10222`, `#10246`) likewise merged into the feature branch, not into master. Do not read the PR numbers as a chronology of master.

The create/update surface was built incrementally on the feature branch: person/place/report create and update for both the local (PouchDB) and remote (HTTP) data contexts, the `input.ts` module, and new endpoints wired through the person/place/report api controllers, `routing.js`, `auth.js`, and `server-utils.js`. The initial local/API `createPerson` work arrived via branch PRs that cite sub-issue `#10036` rather than `#9835`, so they are deliberately not listed in `source_prs` here. The contact controller was modified as well but received **no** write endpoint — it was only migrated to `auth.assertPermissions`; on master it still exposes only `get`, `getUuids`, `getAll`, `getSummaries`, and `routing.js` gained no contact write route.

`#10522` then reworked the internals before the branch merged. Key changes:
- New `ResourceNotFoundError` for update operations when the target document doesn't exist, replacing a misused `InvalidArgumentError` (pre-refactor all three updates threw `InvalidArgumentError('Person not found')` / `'Place not found'` / `'Report not found'`)
- Flattened `isPlace/isPerson/isContact` from curried `(settings) => (doc, uuid?)` to direct two-argument `(settings, doc)` form. This applies to the type guards only — the db-bound helpers (`getDocsByIds`, `createDoc`, `updateDoc`, `minifyDoc`) all remain curried on the PouchDB handle.
- `getDocsByIds` now returns `Nullable<Doc>[]` preserving index positions for parallel lookups; it previously de-duplicated and filtered down to `Doc[]`, so positions were not stable
- `createDoc/updateDoc` no longer re-fetch the document after writing (both previously ended in `getDocById(db)(id)`)
- Lineage handling centralized in `local/libs/lineage.ts` with `minifyDoc`, `assertSameParentLineage`, `getUpdatedContact`. The file itself predates this work; `#10522` consolidated write-side lineage logic into it.
- Input types cleaned up — `_id` and `_rev` are `never` on create inputs (`ContactInput`, `ReportInput`, `PlaceInput`; `PersonInput extends ContactInput`)
- Write-input validation moved into `src/libs/parameter-validators.ts` as composable assertion functions — `assertPersonInput`/`assertPlaceInput`/`assertReportInput`, all built on a shared `assertContactInput`. `src/input.ts` was left as a **types-only** module. Earlier on the branch `input.ts` did hold the validators (the controllers called `Input.validatePersonInput(req.body)`), which is why pre-`#10522` history reads differently — see Design Choices.
- API controllers simplified with `auth.assertPermissions()`, and the spurious read-permission requirement dropped from the write endpoints: `can_view_contacts` for person/place, `can_view_reports` for report. `#10522` is also where `can_edit` first reached the report endpoints.

Earlier branch work, in merge order:
- `#10022` added `byReportQualifier`/`isReportQualifier` and generalized `hasField`/`hasFields` to take a `FieldDescriptor<T>` with an `ensureTruthyValue` flag, laying the groundwork for report create/update.
- `#10081` removed the de-hydrated-lineage validation from `src/qualifier.ts` — `parent`/`contact` on `PersonQualifier`/`PlaceQualifier` became plain id strings — and adjusted person **creation** in `local/person.ts` to derive `contact_type` from settings. It did *not* remove lineage checks from the person local data source, and it did *not* touch person retrieval (`get`/`getWithLineage`/`getPage` are untouched by that commit). The checks were reportedly deemed unnecessary during review of PR #10043; that linkage comes from the PR discussion and is not verifiable from git history.
- `#10222` added `can_edit` as an alternative to `can_create_people`/`can_update_people` and `can_create_places`/`can_update_places` in the **person and place** controllers, and fixed a wrong permission name (`can_update_users` → `can_update_people`). It did **not** change the report controller's permission lists, which stayed `['can_view_reports', 'can_create_records']` and `['can_view_reports', 'can_update_records']`; report's `can_edit` came later, in `#10522`.
- `#10246` normalized an ISO-string `reported_date` on **update** inputs, inside the then-shared `ensureHasRequiredFields` helper in `local/libs/core.ts`, so person/place/report *updates* stopped reporting it as missing. It did not touch the create path, which already normalized `reported_date` in `input.ts`. (`#10522` later replaced `ensureHasRequiredFields` with `assertFieldsUnchanged`, so the helper named here no longer exists on master.)

## Code Patterns

- **Create flow — the three entities genuinely differ; do not reuse one entity's sketch on another.** All of them bind the db handle first (`const minifyMedicDoc = minifyDoc(medicDb)`, `const createMedicDoc = createDoc(medicDb)`), because these helpers are curried.
  - place (the fullest case): `assertPlaceInput(input)` -> `getDocsByIds(medicDb)([input.parent, input.contact])` -> `getParentForCreate`/`getPrimaryContactForCreate` (parent type checked via `assertHasValidParentType`) -> `minifyMedicDoc({...input, ...typeProperties, parent, contact, reported_date})` -> `createMedicDoc(minified)`
  - person: `assertPersonInput(input)` -> a **single serial** `getDocById(medicDb)(input.parent)` -> `assertParent` (which calls `assertHasValidParentType`) -> `minifyMedicDoc({...input, ...typeProperties, parent, reported_date})` -> `createMedicDoc(minified)`. There is no `contact` and no parallel fetch.
  - report: `assertReportInput(input)` -> `Promise.all([getDocById(medicDb)(input.contact), getSupportedForms(medicDb)()])` -> validate `input.form` against the supported-forms list -> `minifyMedicDoc({...input, contact, reported_date, type: DOC_TYPES.DATA_RECORD})` -> `createMedicDoc(minified)`. Reports have no parent, so there is **no** parent-type validation at all.
- **Update flow — also per-entity:**
  - place: `isPlace(settings, updated)` -> `getDocsByIds(medicDb)([updated._id, getContactIdForUpdate(updated)])` -> `getUpdatedContact(settings, medicDb)(original, updated, contactDoc)` -> `assertFieldsUnchanged` -> `assertSameParentLineage` -> `minifyMedicDoc({...updated, contact})` -> `updateDoc(medicDb)(minified)`
  - report: same shape as place, except the guard is `isReport(doc)` — **one argument, no `settings`** — and there is no `assertSameParentLineage`; it uses `await assertUpdatedForm(original, updated, getForms)` instead
  - person: `isPerson(settings, updated)` -> a single `get(dataContext)(Qualifier.byUuid(updated._id))` (no contact to resolve, so no parallel fetch) -> `assertFieldsUnchanged` -> `assertSameParentLineage` -> `minifyMedicDoc(updated)` -> `updateDoc(medicDb)(minified)`
  - all three raise `ResourceNotFoundError` when the original is missing, and `InvalidArgumentError` when the input fails its guard — `'Valid _id, _rev, and type fields must be provided.'` for person/place, `'Valid _id, _rev, form, and type fields must be provided.'` for report
- File: `shared-libs/cht-datasource/src/local/person.ts` — local create/update for persons
- File: `shared-libs/cht-datasource/src/local/place.ts` — local create/update for places
- File: `shared-libs/cht-datasource/src/local/libs/lineage.ts` — centralized lineage validation and minification
- File: `shared-libs/cht-datasource/src/local/libs/doc.ts` — `createDoc`, `updateDoc`, `getDocsByIds` with index-preserving nulls
- File: `shared-libs/cht-datasource/src/libs/parameter-validators.ts` — composable assertion functions
- File: `shared-libs/cht-datasource/src/libs/error.ts` — `ResourceNotFoundError` class
- File: `api/src/controllers/person.js` — simplified controller with `assertPermissions`
- Remote layer uses point-free style: `export const create = postResource('api/v1/person')`
- Each entity exposes a public facade (`src/<entity>.ts`) backed by parallel local (`src/local/<entity>.ts`, PouchDB) and remote (`src/remote/<entity>.ts`, HTTP) implementations selected by data-context; write-input *types* are declared in `src/input.ts` and validated centrally in `src/libs/parameter-validators.ts`; controllers delegate to the datasource guarded by `api/src/auth.js` (as landed by PR #10083)
- Qualifier-based data access: `src/qualifier.ts` builds the read/lookup qualifiers (`Qualifier.byUuid`, `byContactType`, `byFreetext`) that the local and remote data sources consume. PR #10081 reshaped its create/update qualifiers only — it did not change how the person data source reads.

## Design Choices

- `ResourceNotFoundError` semantically distinguishes "document not found" from "bad argument" — mapped to HTTP 404 in `api/src/server-utils.js`, and back to the error class from a 404 response in the remote adapter (`remote/libs/data-context.ts`)
- Index-preserving `getDocsByIds` enables parallel lookups. Note the currying: `const getMedicDocsByIds = getDocsByIds(medicDb); const [parent, contact] = await getMedicDocsByIds([parentId, contactId]);` — `getDocsByIds`, `createDoc`, `updateDoc` and `minifyDoc` are all `(db) => (args) => ...`, so the db handle is bound once at the top of each operation
- Lineage minification reuses the `minify` function from the `@medic/lineage` package (`shared-libs/lineage/src/minify.js`) rather than reimplementing dehydration
- Permission fix: the write endpoints no longer require the matching **read** permission (`can_view_contacts` for person/place, `can_view_reports` for report). Each now asserts `isOnline: true` plus `hasAny` of its own write permission or the general `can_edit`. The six write endpoints do **not** share one permission pair — per endpoint on master:
  - `POST /api/v1/person` — `hasAny: ['can_create_people', 'can_edit']`
  - `PUT /api/v1/person/:uuid` — `hasAny: ['can_update_people', 'can_edit']`
  - `POST /api/v1/place` — `hasAny: ['can_create_places', 'can_edit']`
  - `PUT /api/v1/place/:uuid` — `hasAny: ['can_update_places', 'can_edit']`
  - `POST /api/v1/report` — `hasAny: ['can_create_records', 'can_edit']`
  - `PUT /api/v1/report/:uuid` — `hasAny: ['can_update_reports', 'can_edit']` (note `can_update_reports`, not the `can_update_records` used before the refactor)
- The read endpoints keep `hasAll`, not `hasAny`: `['can_view_contacts']` for contact/person/place, `['can_view_reports']` for report
- Auth refactored to `assertPermissions(req, { isOnline = false, hasAll = [], hasAny = [] })` pattern for consistency, with the legacy `auth.check(req, permissions)` retained as a `hasAll` wrapper
- `src/input.ts` is a types-only module by design after `#10522`: the input *shapes* (including `_id`/`_rev` as `never`) live there, while all runtime assertion lives in `src/libs/parameter-validators.ts`. Descriptions of `input.ts` performing validation describe the pre-`#10522` feature-branch state, not master.

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
- shared-libs/cht-datasource/src/local/libs/core.ts (`assertFieldsUnchanged`, `getReportedDateTimestamp`; hosted the `ensureHasRequiredFields` helper patched by PR #10246)
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

- Unit tests updated across most changed cht-datasource modules — 19 spec files under `shared-libs/cht-datasource/test/` in the `#10083` landing, against 23 changed `src` files. Not every changed module got a spec: `src/input.ts` was added with no spec at all (there is no `test/input.spec.ts` on master), and `src/libs/error.ts`, `src/libs/doc.ts` and `src/local/libs/data-context.ts` changed without a matching spec change in that commit.
- Integration tests for API controllers under `tests/integration/api/controllers/{person,place,report}.spec.js`, plus datasource-level integration tests under `tests/integration/shared-libs/cht-datasource/`
- Tests verify both create and update flows for persons, places, and reports
- Tests cover permission validation, lineage validation, and error handling
- Integration tests under `tests/integration/api/controllers/person.spec.js` and `tests/integration/shared-libs/cht-datasource/person.spec.js` updated when lineage checks were removed (PR #10081)

## Related Issues

- PR #10083: the umbrella PR for issue #9835 — it squashed the entire feature branch onto master as `f382785be`, so every other PR listed here is contained in it, including the `#10522` refactor. It is not a predecessor of `#10522`.
- PR #10522: refactored the create/update surface *on the feature branch*, before `#10083` landed (`a89955a9f` is an ancestor of `#10083`'s head)
- PR #10081: removed the de-hydrated-lineage checks from `src/qualifier.ts` and reworked person creation in `local/person.ts`; it did not change the person data source's lineage handling or any retrieval path
- PR #10043: review discussion here reportedly prompted removing the lineage checks in PR #10081. This linkage is from the PR conversation, not the git history — `#10043` itself is `feat(#10036): add PersonQualifier and related functions`, filed against sub-issue #10036.
- Sub-issue #10036: carries the branch PRs that first added local/API `createPerson` (the "initial create/update surface" above); tracked in its own drafts rather than in `source_prs` here

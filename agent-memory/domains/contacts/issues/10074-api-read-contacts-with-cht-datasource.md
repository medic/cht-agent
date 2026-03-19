---
id: cht-core-10074
category: refactoring
domain: contacts
subDomain: cht-datasource
issueNumber: 10074
issueUrl: https://github.com/medic/cht-core/issues/10074
title: Update API migrations to read contacts with cht-datasource
lastUpdated: 2026-03-16
summary: Migrated two API migration scripts from direct db.medic calls to the cht-datasource Contact.v1 API, replacing 404-catch patterns with null-check patterns and CouchDB view queries with async generators.
services:
  - api
techStack:
  - javascript
  - couchdb
---

## Problem

Two migration scripts in `api/src/migrations/` were making direct calls to `db.medic` (raw PouchDB) to fetch contact documents. The project-wide direction is to route all contact reads through `cht-datasource` via the `data-context` service, which provides a consistent, testable abstraction layer over the database.

## Root Cause

The migration scripts predated `cht-datasource` and used raw PouchDB calls directly. The targeted scripts were:
- `associate-records-with-people.js` — `getContact()` and `getClinic()` functions
- `extract-person-contacts.js` — `createPerson()`, `resetParent()`, `updateParents()`, and `migrateOneType()` functions

## Solution

PR #10085 replaced all `db.medic.get(id)` calls with `dataContext.bind(Contact.v1.get)(Qualifier.byUuid(id))`. The critical behavioral difference: PouchDB's `get()` throws with `{ status: 404 }` when not found, while cht-datasource `Contact.v1.get` returns `null`. All `catch` blocks checking `err.status === 404` were replaced with `then` handlers containing null-checks.

For `migrateOneType()`, the direct CouchDB view query (`db.medic.query('medic-client/contacts_by_type')`) was replaced with the `Contact.v1.getUuids` async generator via `Qualifier.byContactType(type)`.

## Code Patterns

- Replace `db.medic.get(id).catch(err => { if (err.status === 404) ... })` with `dataContext.bind(Contact.v1.get)(Qualifier.byUuid(id)).then(doc => { if (!doc) ... })`
- Replace CouchDB view queries with `Contact.v1.getUuids` async generator: `for await (const id of generator) { ... }`
- File: `api/src/migrations/associate-records-with-people.js` — `getContact()` and `getClinic()` migrated to cht-datasource
- File: `api/src/migrations/extract-person-contacts.js` — four functions migrated, `migrateOneType` uses async generator
- File: `api/src/services/data-context.js` — the service that provides `getLocalDataContext(config, db)`
- Test pattern: stub `dataContext.bind` instead of `db.medic.get`, use `null` for "not found" instead of `Promise.reject({ status: 404 })`

## Design Choices

- Used `dataContext.bind(Contact.v1.get)` pattern consistent with other cht-datasource consumers in the codebase
- Extracted `migrate` as a top-level function to avoid function nesting deeper than 4 levels (SonarCloud constraint)
- Kept the existing callback-based structure in `extract-person-contacts.js` while wrapping async generator iteration in a Promise bridge

## Related Files

- api/src/migrations/associate-records-with-people.js
- api/src/migrations/extract-person-contacts.js
- api/src/services/data-context.js

## Testing

- Updated tests to stub `dataContext.bind` rather than `db.medic.get`
- Used `null` to simulate "not found" instead of `Promise.reject({ status: 404 })`
- Async generator stubs for `migrateOneType`: `contactGetUuids.returns(async function* () { yield 'a'; }())`
- Tests cover all three migrated contact types: `district_hospital`, `health_center`, `clinic`

## Related Issues

- #9835: Add cht-datasource APIs for creation/update of contacts (the write-side counterpart)

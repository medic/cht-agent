---
id: cht-core-9237
category: feature
domain: contacts
domainFit: strong
issueNumber: 9237
issueUrl: https://github.com/medic/cht-core/issues/9237
title: Add paginated person retrieval (Person.v1.getPage) to cht-datasource
lastUpdated: '2026-06-23'
summary: The cht-datasource Person module could fetch a single person but had no way to list people in pages. This PR adds Person.v1.getPage(limit, skip) with local and remote implementations and supporting pagination primitives.
services:
  - api
  - webapp
techStack:
  - typescript
  - pouchdb
  - couchdb
tags:
  - pagination
  - cht-datasource
  - person
  - data-access
  - contacts
  - shared-library
related_workflows: []
source_pr: medic/cht-core#9266
source_sha: b20dc22977bbdb9c177069a309031d24015d08bd
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/qualifier.ts
  - shared-libs/cht-datasource/src/libs/core.ts
  - shared-libs/cht-datasource/src/index.ts
concepts:
  - pagination
  - data access layer
  - local vs remote data context
  - API versioning (v1)
  - facade delegation
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

The cht-datasource Person module supported fetching a single person by UUID (with or without lineage) but provided no supported way to retrieve multiple people in a paginated manner, so consumers needing to list people had no public API for it.

## Root Cause

Not a bug but a missing capability: paginated retrieval (getPage and its limit/skip handling) had never been implemented in the public Person facade or in the local (PouchDB) and remote (API) person modules.

## Solution

Added Person.v1.getPage(limit, skip) to the cht-datasource public API with limit/skip defaulting to 100/0. Implemented local (PouchDB-backed) and remote (API-backed) variants behind the shared person facade, extended the core libs, doc, lineage, and qualifier helpers to support pagination, and exported the new function from index.ts.

## Code Patterns

Person.v1.getPage follows the existing dual local/remote pattern in cht-datasource: a public facade in src/person.ts delegates to src/local/person.ts or src/remote/person.ts based on the active data context. Pagination primitives added to src/libs/core.ts and src/local/libs/doc.ts are reusable for paginating other datasource entities.

## Design Choices

Pagination uses limit/skip with sensible defaults (100/0) so callers can omit arguments, and local and remote implementations share a common interface so consumers need not know which data source backs the call.

## Related Files

- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/local/libs/lineage.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/remote/libs/data-context.ts
- shared-libs/cht-datasource/src/remote/person.ts

## Testing

Extensive unit tests added/updated across the library: test/person.spec.ts, test/local/person.spec.ts, test/remote/person.spec.ts, test/qualifier.spec.ts, test/index.spec.ts, plus local doc and lineage lib specs and remote data-context spec. A simple CI linting error was fixed before merge.

## Related Issues

- #9237: add functionality of getting people with pagination in cht-datasource

## Domain Rationale

**Fit:** strong

The PR adds a paginated retrieval API for Person entities, and a person is a contact in CHT, so this squarely concerns contact lookup and management. The cht-datasource Person module is an application-level data access layer for the contact domain, not storage-engine internals, so it stays in contacts rather than data-sync.

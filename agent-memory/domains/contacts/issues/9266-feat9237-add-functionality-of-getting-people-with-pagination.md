---
id: cht-core-9237
category: feature
domain: contacts
domainFit: strong
issueNumber: 9237
issueUrl: https://github.com/medic/cht-core/issues/9237
title: Add paginated person retrieval (Person.v1.getPage) to cht-datasource
lastUpdated: '2026-08-12'
summary: The cht-datasource Person module could fetch a single person but had no way to list people in pages. This PR adds Person.v1.getPage(context)(personType, limit, skip) — personType mandatory, limit/skip defaulting to 100/0 — with local and remote implementations and supporting pagination primitives. Note that skip was replaced by a string cursor before this work reached master; see the stale-as-written banner.
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

> **Epic child.** PR #9266 was squash-merged into the feature branch
> `9193-api-endpoints-for-getting-contacts-by-type` (`b20dc2297`), not into master.
> That branch reached master as PR #9311 (`34dd0303c`). Its own PR number is stamped
> nowhere on master, which is why this draft's `source_sha` does not resolve in a plain
> clone. Fetch it with `git fetch origin +refs/pull/9311/head:refs/verify/pr9311` — PR
> #9266's own head ref does *not* contain the anchor, because that ref is the pre-squash
> branch tip and `b20dc2297` was created by the squash onto the feature branch.
>
> **Superseded before landing (`stale-as-written`):** as this PR wrote it, `getPage` took
> `(personType, limit = 100, skip = 0)`. The numeric `skip` was replaced by a string
> `cursor` — moved ahead of `limit` — by the next child PR #9281 (`bf8a77dae`) three days
> later on the same feature branch, before the epic ever landed. So on master the
> signature is `(personType, cursor: Nullable<string> = null, limit = DEFAULT_DOCS_PAGE_LIMIT)`
> and `skip` has never existed in `src/person.ts` on master at all. Everything below
> describes the anchor commit, not today's API.

## Problem

The cht-datasource Person module supported fetching a single person by UUID (with or without lineage) but provided no supported way to retrieve multiple people in a paginated manner, so consumers needing to list people had no public API for it.

## Root Cause

Not a bug but a missing capability: paginated retrieval (getPage and its limit/skip handling) had never been implemented in the public Person facade or in the local (PouchDB) and remote (API) person modules.

## Solution

Added `Person.v1.getPage(context)(personType, limit, skip)` to the cht-datasource public API — the function is curried by data context, `personType` is a mandatory `ContactTypeQualifier`, and `limit`/`skip` default to 100/0. Implemented local (PouchDB-backed) and remote (API-backed) variants behind the shared person facade, extended the core libs, doc, and qualifier helpers to support pagination — `queryDocsByKey` was repurposed as the paginating `(key, limit, skip)` variant and the old key-range form renamed `queryDocsByRange`, which is why `local/libs/lineage.ts` also changed even though it gained no pagination — and added a `getDatasource` convenience wrapper `getPageByType(personType, limit = 100, skip = 0)` in index.ts (the `Person` namespace was already re-exported there, so `getPage` itself needed no new export).

## Code Patterns

Person.v1.getPage follows the existing dual local/remote pattern in cht-datasource: a public facade in src/person.ts delegates to src/local/person.ts or src/remote/person.ts based on the active data context. Pagination primitives added to src/libs/core.ts and src/local/libs/doc.ts are reusable for paginating other datasource entities.

## Design Choices

Pagination uses limit/skip with sensible defaults (100/0) so callers can omit `limit` and `skip`; the person-type qualifier and the data context stay mandatory — `assertTypeQualifier` throws `Invalid type [undefined].` if the qualifier is missing, and `assertDataContext` throws `Invalid data context [undefined].` if the context is. Local and remote implementations share a common interface (`(personType, limit, skip) => Promise<Page<Person>>`) so consumers need not know which data source backs the call.

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

Extensive unit tests added/updated across the library: test/person.spec.ts, test/local/person.spec.ts, test/remote/person.spec.ts, test/qualifier.spec.ts, test/index.spec.ts, plus local doc and lineage lib specs and remote data-context spec.

## Related Issues

- #9237: add functionality of getting people with pagination in cht-datasource

## Domain Rationale

**Fit:** strong

The PR adds a paginated retrieval API for Person entities, and a person is a contact in CHT, so this squarely concerns contact lookup and management. The cht-datasource Person module is an application-level data access layer for the contact domain, not storage-engine internals, so it stays in contacts rather than data-sync.

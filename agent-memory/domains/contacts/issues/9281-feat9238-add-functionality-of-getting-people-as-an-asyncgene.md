---
id: cht-core-9238
category: feature
domain: contacts
domainFit: strong
issueNumber: 9238
issueUrl: https://github.com/medic/cht-core/issues/9238
title: Add Person.v1.getAll AsyncGenerator to cht-datasource for paginated iteration over all people
lastUpdated: '2026-08-20'
summary: cht-datasource could only fetch a single page of people at a time — `getPage` took a numeric `skip`, so callers tracked offsets by hand. This adds Person.v1.getAll(ctx)(qualifier), returning an AsyncGenerator that yields individual person docs one at a time — fetching a page at a time internally and following the cursor. It works over both local and remote data contexts without being implemented in either — the generator binds the facade's own cursor-paginated getPage, and that is what dispatches (adapt at person.ts:95).
services:
  - api
  - webapp
techStack:
  - typescript
tags:
  - async-generator
  - pagination
  - cht-datasource
  - person
  - data-access
  - getAll
  - cursor
related_workflows: []
source_pr: medic/cht-core#9281
source_sha: bf8a77dae6ae550019134ba66c83b68e633e41c9
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/libs/core.ts
  - shared-libs/cht-datasource/src/libs/data-context.ts
  - shared-libs/cht-datasource/src/index.ts
concepts:
  - AsyncGenerator / lazy async iteration
  - cursor-based pagination
  - local-vs-remote data-context abstraction
  - API versioning (v1)
  - curried data-source API signature
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

> **Epic child.** PR #9281 was squash-merged into the feature branch
> `9193-api-endpoints-for-getting-contacts-by-type` (`bf8a77da`), not into master.
> That branch reached master as PR #9311 (`34dd0303c`). Its own PR number is stamped
> nowhere on master, which is why this draft's `source_sha` does not resolve in a plain
> clone. Fetch it with `git fetch origin +refs/pull/9311/head:refs/verify/pr9311` — the
> epic PR's head ref. PR #9281's *own* head ref does not contain the anchor: that ref is
> the pre-squash branch tip (`7e0355f3a`, a merge commit), whereas `bf8a77dae` was created
> by the squash onto the feature branch. `git for-each-ref --contains bf8a77dae` lists
> only the 9295 and 9311 pull refs.
>
> **Renamed before landing (`stale-as-written`):** the helper below is
> `getDocumentStream` in `libs/data-context.ts` as this PR wrote it.
> On master that same mechanism is `getPagedGenerator`, in `libs/core.ts`.
> On master `getDocumentStream` no longer exists in `shared-libs/cht-datasource/src`.
> On master the yield loop is still one-doc-at-a-time, but more than the name changed.
> Two separate drifts, in order:
>
> - *Inside the epic, before it landed* (`34dd0303c`): the generator's return type went
>   `AsyncGenerator<T, void>` → `AsyncGenerator<T, null>` with an explicit `return null`,
>   the starting cursor went `'0'` → `null`, and the end-of-iteration test went from the
>   sentinel string (`cursor !== '-1'`) to plain truthiness of the cursor, with
>   `Page.cursor` retyped `string` → `Nullable<string>` to suit. So master never saw the
>   `'-1'` sentinel for people at all.
> - *Later, on master* (`869f5db66`, #10622, 2026-02-11): the hard-coded `const limit = 100`
>   that this PR passed on every fetch was dropped, and the helper now calls
>   `fetchFunction(fetchFunctionArgs, currentCursor)` with no limit (`l?: number`),
>   deferring to `getPage`'s own default page size.

## Problem

Consumers of cht-datasource could only retrieve a single page of people at a time through `getPage`, which took a numeric `skip` at this point, so they had to track and pass offsets by hand to assemble the full result set. There was no convenient, memory-efficient way to iterate over all matching person documents.

## Root Cause

This is a feature gap rather than a defect: the Person v1 API exposed only single-page (getPage) and by-UUID retrieval and lacked any streaming/iterator abstraction over the complete result set, leaving cross-page iteration logic to be duplicated by every caller.

## Solution

Added Person.v1.getAll(ctx)(qualifier), returning `AsyncGenerator<Person, void>` — it yields **individual person docs one at a time**, paging internally on demand by repeatedly invoking the cursor-paginated fetch until exhausted. `getAll` itself was added **only to the public person.ts facade** — there is no `getAll` in local/person.ts or remote/person.ts, at this commit or on master — plus a thin `getDatasource` wrapper `getByType(personType)` in index.ts that binds it. The facade generator binds the facade's *own* `getPage` (`const getPage = context.bind(v1.getPage)`), so local-vs-remote dispatch is inherited from `getPage`'s existing `adapt` call rather than reimplemented per context. The shared generator helper `getDocumentStream` was added to libs/data-context.ts. The same PR touched remote/person.ts only to replace getPage's numeric `skip` parameter with a string `cursor`, moving it ahead of `limit` in the signature; local/person.ts got that swap plus a rewrite of `fetchAndFilter`'s paging arithmetic — the end-of-results test moved from `docs.length === 0` to `docs.length < currentLimit`, and the over-fetch bookkeeping was restructured.

## Code Patterns

AsyncGenerator-based pagination: a generic helper `getDocumentStream` in shared-libs/cht-datasource/src/libs/data-context.ts wraps a page-fetching function plus its argument into an `async function*` that fetches a page, re-yields its documents individually (`for (const doc of docs.data) { yield doc }`), then follows the cursor until the page reports the end of iteration — which at this commit means the sentinel string `cursor === '-1'`, see the banner; reusable for other entity types. Consumed as a flat loop over documents — `for await (const person of Person.v1.getAll(ctx)(Qualifier.byContactType('person'))) { ... }` — with no page-handling in the caller.

## Design Choices

The generator yields individual docs rather than pages, so callers iterate with a single flat `for await` and never see a cursor; paging stays an internal detail of the helper, which keeps only one page in memory at a time. `getPage` remains exported for callers that genuinely need page-at-a-time control — its doc comment points at `getAll` as the way to avoid accounting for paging manually. The curried `getAll(ctx)(qualifier)` shape mirrors the existing cht-datasource API style for consistency.

## Related Files

- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/libs/data-context.ts
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/test/person.spec.ts
- shared-libs/cht-datasource/test/local/person.spec.ts
- shared-libs/cht-datasource/test/remote/person.spec.ts
- shared-libs/cht-datasource/test/libs/data-context.spec.ts
- shared-libs/cht-datasource/test/index.spec.ts

## Testing

Unit tests updated — every spec file in this PR is modified, none added — for the public facade (test/person.spec.ts), the generator helper (test/libs/data-context.spec.ts), and the `getDatasource` surface (test/index.spec.ts, which gained a `getByType` case asserting it binds `Person.v1.getAll`). The local and remote person *specs* changed only for getPage's `skip`→`cursor` plumbing (every changed line in both is the swap) and contain no `getAll` cases, matching the facade-only implementation — which means the `fetchAndFilter` paging-arithmetic rewrite in local/person.ts landed with no new spec assertions in this commit. The helper's own cases state the contract directly — "yields document one by one", "should handle multiple pages", "should handle empty result" — and the facade test drains the generator with `for await` and deep-equals the result against the flat array of people, not against a list of pages.

## Related Issues

- #9238: Add functionality to get people as an AsyncGenerator in cht-datasource

## Domain Rationale

**Fit:** strong

The PR adds a data-access API specifically for retrieving 'people' (person-type contacts) via cht-datasource's Person module; persons are core contact entities in CHT, so contacts is the most specific fit. It is not data-sync (no replication concern) nor interoperability (no external/standards integration) — it is contact retrieval.

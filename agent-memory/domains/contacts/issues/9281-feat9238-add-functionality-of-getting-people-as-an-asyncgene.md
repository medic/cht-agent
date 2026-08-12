---
id: cht-core-9238
category: feature
domain: contacts
domainFit: strong
issueNumber: 9238
issueUrl: https://github.com/medic/cht-core/issues/9238
title: Add Person.v1.getAll AsyncGenerator to cht-datasource for paginated iteration over all people
lastUpdated: '2026-08-11'
summary: cht-datasource could only fetch a single page of people at a time — `getPage` took a numeric `skip`, so callers tracked offsets by hand. This adds Person.v1.getAll(ctx)(qualifier), returning an AsyncGenerator that yields individual person docs one at a time — fetching a page at a time internally and following the cursor — across both local and remote data contexts.
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
stale: false
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
> That branch reached master as PR #9311. Its own PR number is stamped nowhere on
> master, which is why this draft's `source_sha` does not resolve in a plain clone —
> `git fetch origin refs/pull/9281/head` makes it reachable.
>
> **Renamed before landing (`stale-as-written`):** the helper below is
> `getDocumentStream` in `libs/data-context.ts` as this PR wrote it.
> On master that same mechanism is `getPagedGenerator`, in `libs/core.ts`.
> On master `getDocumentStream` no longer exists in `shared-libs/cht-datasource/src`.
> The yield semantics are unchanged — on master the signature is
> `AsyncGenerator<Person, null>`, differing only in the generator's return type.

## Problem

Consumers of cht-datasource could only retrieve a single page of people at a time through `getPage`, which took a numeric `skip` at this point, so they had to track and pass offsets by hand to assemble the full result set. There was no convenient, memory-efficient way to iterate over all matching person documents.

## Root Cause

This is a feature gap rather than a defect: the Person v1 API exposed only single-page (getPage) and by-UUID retrieval and lacked any streaming/iterator abstraction over the complete result set, leaving cross-page iteration logic to be duplicated by every caller.

## Solution

Added Person.v1.getAll(ctx)(qualifier), returning `AsyncGenerator<Person, void>` — it yields **individual person docs one at a time**, paging in the background by repeatedly invoking the cursor-paginated fetch until exhausted. Implemented across the public person.ts facade and both the local (PouchDB) and remote (HTTP/API) person implementations, with a shared generator helper `getDocumentStream` added to libs/data-context.ts. The same PR also replaced getPage's numeric `skip` parameter with a string `cursor`, moving it ahead of `limit` in the signature.

## Code Patterns

AsyncGenerator-based pagination: a generic helper `getDocumentStream` in shared-libs/cht-datasource/src/libs/data-context.ts wraps a page-fetching function plus its argument into an `async function*` that fetches a page, re-yields its documents individually (`for (const doc of docs.data) { yield doc }`), then follows the cursor until it reports no more data; reusable for other entity types. Consumed as a flat loop over documents — `for await (const person of Person.v1.getAll(ctx)(Qualifier.byContactType('person'))) { ... }` — with no page-handling in the caller.

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

Unit tests were added/updated for the public facade (test/person.spec.ts), the local and remote implementations (test/local/person.spec.ts, test/remote/person.spec.ts), the core/data-context helpers (test/libs/data-context.spec.ts), and the exported index surface (test/index.spec.ts). The helper's own cases state the contract directly — "yields document one by one", "should handle multiple pages", "should handle empty result" — and the facade test drains the generator with `for await` and deep-equals the result against the flat array of people, not against a list of pages.

## Related Issues

- #9238: Add functionality to get people as an AsyncGenerator in cht-datasource

## Domain Rationale

**Fit:** strong

The PR adds a data-access API specifically for retrieving 'people' (person-type contacts) via cht-datasource's Person module; persons are core contact entities in CHT, so contacts is the most specific fit. It is not data-sync (no replication concern) nor interoperability (no external/standards integration) — it is contact retrieval.

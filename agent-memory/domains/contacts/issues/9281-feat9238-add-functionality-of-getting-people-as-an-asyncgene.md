---
id: cht-core-9281
category: feature
domain: contacts
domainFit: strong
issueNumber: 9281
issueUrl: https://github.com/medic/cht-core/issues/9281
title: Add Person.v1.getAll AsyncGenerator to cht-datasource for paginated iteration over all people
lastUpdated: '2026-06-23'
summary: cht-datasource could only fetch a single cursor-paginated page of people at a time, forcing callers to manage cursors manually. This adds Person.v1.getAll(ctx)(qualifier), returning an AsyncGenerator that lazily yields successive pages of person docs across both local and remote data contexts.
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

## Problem

Consumers of cht-datasource could only retrieve a single page of people at a time through the cursor-paginated getPage API, so they had to manually track and pass cursors to assemble the full result set. There was no convenient, memory-efficient way to iterate over all matching person documents.

## Root Cause

This is a feature gap rather than a defect: the Person v1 API exposed only single-page (getPage) and by-UUID retrieval and lacked any streaming/iterator abstraction over the complete result set, leaving cross-page iteration logic to be duplicated by every caller.

## Solution

Added Person.v1.getAll(ctx)(qualifier) which returns an AsyncGenerator that lazily yields successive pages of person docs by repeatedly invoking the paginated fetch and following the returned cursor until exhausted. Implemented across the public person.ts facade and both the local (PouchDB) and remote (HTTP/API) person implementations, with a shared generator helper added in libs/core.ts.

## Code Patterns

AsyncGenerator-based pagination: a generic helper in shared-libs/cht-datasource/src/libs/core.ts wraps a page-fetching function plus qualifier into an `async function*` that yields each page and follows the cursor until no more data remains; reusable for other entity types. Consumed as `const it = Person.v1.getAll(ctx)(Qualifier.byContactType('person')); for await (const page of it) { for (const doc of page) { ... } }`.

## Design Choices

The generator yields pages (arrays of docs) rather than individual docs, letting callers control memory and batch processing while iterating lazily with for-await-of. The curried `getAll(ctx)(qualifier)` shape mirrors the existing cht-datasource API style for consistency; reviewers (m5r, Josh) explicitly approved the API design.

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

Unit tests were added/updated for the public facade (test/person.spec.ts), the local and remote implementations (test/local/person.spec.ts, test/remote/person.spec.ts), the core/data-context helpers (test/libs/data-context.spec.ts), and the exported index surface (test/index.spec.ts), asserting that the AsyncGenerator yields all pages across cursor boundaries for both local and remote contexts.

## Related Issues

- #9238: Add functionality to get people as an AsyncGenerator in cht-datasource

## Domain Rationale

**Fit:** strong

The PR adds a data-access API specifically for retrieving 'people' (person-type contacts) via cht-datasource's Person module; persons are core contact entities in CHT, so contacts is the most specific fit. It is not data-sync (no replication concern) nor interoperability (no external/standards integration) — it is contact retrieval.

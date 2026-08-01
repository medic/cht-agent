---
id: cht-core-9704
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9704
issueUrl: https://github.com/medic/cht-core/issues/9704
title: Throw PouchDB errors when saving target documents in the rules-engine pouchdb-provider
lastUpdated: '2026-08-01'
summary: The catch-all on the PouchDB READ that precedes a target-doc write handled only `err.status === 404`, returning a freshly-built target doc; every other rejection fell through silently, so a real PouchDB failure produced neither a document nor an error. The provider now rethrows any non-404 error from the target-doc read so the errors propagate.
services:
  - webapp
techStack:
  - javascript
  - pouchdb
tags:
  - rules-engine
  - target-documents
  - error-handling
  - pouchdb
  - error-propagation
related_workflows: []
source_pr: medic/cht-core#9705
source_sha: 0738e80d39c2fd1dc57ddae1f03c2860600e2ede
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/pouchdb-provider.js
concepts:
  - error-handling
  - error-propagation
  - bulk document writes
  - rules-engine persistence
  - target documents
related_issues: []
stale: false
---

## Problem

When the rules-engine saved (committed) target documents through the pouchdb-provider, any PouchDB error on the write was silently ignored rather than surfaced to the caller. The failure was swallowed on the read that precedes the write: `commitTargetDoc` caught every rejection from `db.get`, but returned a freshly-built target doc only when `err.status === 404` and returned `undefined` for anything else — so a genuine store error was never reported as itself, surfacing at best as a downstream `TypeError` when the `undefined` document was dereferenced.

## Root Cause

`commitTargetDoc` read the existing doc with `db.get(_id)` and attached a `.catch(err => …)` that returned a newly-constructed target doc when `err.status === 404` but silently fell through for every other rejection, so non-404 PouchDB errors were never surfaced or rethrown.

## Solution

Added `throw err;` to the `.catch` in `commitTargetDoc` in pouchdb-provider.js so only `err.status === 404` yields a new target doc and every other PouchDB error propagates to the caller. The PR also rewrote `contactsBySubjectId` and `taskDataFor` in async/await form.

## Code Patterns

When a `.catch` on a PouchDB read exists only to synthesise a default document, gate it on the expected status and rethrow everything else: `commitTargetDoc` in shared-libs/rules-engine/src/pouchdb-provider.js returns a freshly-built target doc when `err.status === 404` and now ends the handler with `throw err;`, so every other read failure reaches the caller. (The one `bulkDocs` call in this file is `commitTaskDocs`, whose errors are still only `console.error`-ed.)

## Design Choices

Chose to rethrow unexpected errors from the target-doc READ rather than let a catch-all drop them, so a real PouchDB failure surfaces instead of vanishing — previously only a 404 produced a usable result and every other rejection fell through returning nothing. Writes were left as they were — the one `bulkDocs` in this file, `commitTaskDocs`, still only `console.error`s — aligning target persistence with proper error-propagation semantics.

## Related Files

- shared-libs/rules-engine/src/pouchdb-provider.js
- shared-libs/rules-engine/test/pouchdb-provider.spec.js

## Testing

Unit tests in shared-libs/rules-engine/test/pouchdb-provider.spec.js were added/updated to assert that PouchDB errors encountered while saving target docs are thrown/propagated rather than swallowed.

## Related Issues

- #9704: PouchDB errors when saving target docs were swallowed instead of thrown

## Domain Rationale

**Fit:** strong

The change lives in shared-libs/rules-engine and specifically governs how target documents are persisted; targets are a core entity of the tasks-and-targets domain, so this is a principled fit rather than the generic data-layer bucket.

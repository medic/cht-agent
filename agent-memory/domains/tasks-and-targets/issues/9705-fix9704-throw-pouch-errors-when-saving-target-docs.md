---
id: cht-core-9704
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9704
issueUrl: https://github.com/medic/cht-core/issues/9704
title: Throw PouchDB errors when saving target documents in the rules-engine pouchdb-provider
lastUpdated: '2026-06-22'
summary: Errors returned by PouchDB while saving target documents were being silently swallowed, so callers could not detect failed writes. The provider now inspects write results and throws so the errors propagate.
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

When the rules-engine saved (committed) target documents through the pouchdb-provider, any PouchDB error on the write was silently ignored rather than surfaced to the caller. PouchDB's write path resolves even when an individual document fails, so failures (e.g. conflicts or other store errors) went undetected, risking silent loss or inconsistency of target state with no error reported.

## Root Cause

The target-doc save path in pouchdb-provider.js did not inspect the per-document result/error from the PouchDB write (bulkDocs resolves successfully even when individual docs error), so error entries were never checked or rethrown.

## Solution

Updated the target-doc save logic in pouchdb-provider.js to inspect the PouchDB write results and throw when a document write returns an error, ensuring PouchDB errors propagate to the caller instead of being swallowed.

## Code Patterns

When persisting via PouchDB bulkDocs, always inspect the returned results array for per-document error entries and throw on them, because bulkDocs resolves even on partial/individual failures. See shared-libs/rules-engine/src/pouchdb-provider.js.

## Design Choices

Chose to throw on write error rather than log-and-continue so that failures are not silently swallowed and callers can react to a failed target-doc save, aligning target persistence with proper error-propagation semantics.

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

---
id: cht-core-10384
category: improvement
domain: data-sync
domainFit: strong
issueNumber: 10384
issueUrl: https://github.com/medic/cht-core/issues/10384
title: Replace CouchDB _changes feed with allDocs when fetching purged documents to fix performance degradation on large purging databases
lastUpdated: '2026-06-22'
summary: Fetching documents from purging databases used the _changes feed with a _doc_ids filter, causing severe performance degradation as those databases grew. The fix switches to allDocs and adapts the code to its response format.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
  - pouchdb
tags:
  - purging
  - replication
  - performance
  - allDocs
  - changes-feed
  - couchdb
related_workflows: []
source_pr: medic/cht-core#10396
source_sha: ea8e1eb282a52ac5f97a45790820bae1db8d415a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/purged-docs.js
  - sentinel/src/lib/purging.js
concepts:
  - document purging
  - replication
  - CouchDB _changes feed
  - allDocs bulk fetch
  - query performance optimization
related_issues: []
stale: false
---

## Problem

When fetching documents from purging databases during replication and purging, the implementation used the _changes feed with a _doc_ids filter. On large purging databases this caused severe performance degradation.

## Root Cause

The _changes feed with a _doc_ids filter scans the change history and scales poorly as the purging database grows, making it the wrong primitive for fetching a known set of documents by ID (api/src/services/purged-docs.js, sentinel/src/lib/purging.js).

## Solution

Replaced the _changes feed + _doc_ids filter query with allDocs (keyed lookup). Adjusted result handling for allDocs' response shape: iterate response.rows instead of response.results, and read the deletion flag from row.value.deleted instead of the top-level deleted field.

## Code Patterns

When migrating a CouchDB/PouchDB query from the _changes feed to allDocs: read documents from response.rows (not response.results), and obtain the deleted flag from row.value.deleted (not the top-level change.deleted). Applied in api/src/services/purged-docs.js and sentinel/src/lib/purging.js.

## Design Choices

allDocs with explicit keys is far more efficient than a filtered _changes feed for retrieving a known, finite set of documents by ID, and the gap widens as the database grows — so it was chosen over the changes-feed approach for scalability.

## Related Files

- api/src/services/purged-docs.js
- api/tests/mocha/services/purged-docs.spec.js
- sentinel/src/lib/purging.js
- sentinel/tests/unit/lib/purging.spec.js

## Testing

Updated existing unit tests in api/tests/mocha/services/purged-docs.spec.js and sentinel/tests/unit/lib/purging.spec.js — primarily find/replace adapting mocks/assertions from the _changes format to the allDocs format (rows instead of results, deleted nested under value).

## Related Issues

- #10384: Severe performance degradation when fetching from purging databases via the _changes feed with a _doc_ids filter on large databases

## Domain Rationale

**Fit:** strong

Purging databases govern which documents are replicated to a user's offline device and are queried directly during replication and purging, so this is core to the sync/replication mechanism rather than an operational concern.

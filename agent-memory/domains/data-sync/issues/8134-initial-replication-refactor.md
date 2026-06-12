---
id: cht-core-8134
category: improvement
domain: data-sync
subDomain: initial-replication
issueNumber: 8134
issueUrl: https://github.com/medic/cht-core/issues/8134
title: Refactor initial replication to not use PouchDB replicate
lastUpdated: 2023-05-11
summary: Replaced PouchDB's standard initial replication process with a custom replication mechanism that directly downloads required documents, significantly improving initial sync performance for offline users.
services:
  - webapp
  - api
techStack:
  - javascript
  - couchdb
  - pouchdb
---

## Problem

Initial replication was slow for offline users with large datasets.

PouchDB's replication process relied heavily on CouchDB `_changes` requests, which became expensive because the server first had to determine which documents the user was allowed to access and then generate change feeds for those documents.

This caused slow initial application setup and poor scalability for large deployments.

## Root Cause

The standard PouchDB replication workflow performed multiple expensive operations:

1. Request `_changes`
2. Check which documents already existed locally
3. Download missing documents using `_bulk_get`
4. Repeat until replication completed

The `_changes` request was particularly expensive because it required permission filtering and large view queries before returning results.

## Solution

Implemented a custom initial replication protocol.

Instead of relying on PouchDB replication:

1. API returns document IDs, revisions, and database sequence information.
2. Client compares server revisions with local revisions.
3. Client downloads only missing or outdated documents using batched requests.
4. Once complete, normal replication resumes using the latest sequence value.

This greatly reduced the number of expensive `_changes` requests during initial setup.

## Code Patterns

- Use custom replication strategies when generic database replication becomes a bottleneck.
- Compare revisions before downloading documents.
- Download only missing documents instead of processing full changes feeds.
- Separate initial replication from continuous replication workflows.

## Design Choices

- Chose a custom protocol instead of optimizing PouchDB internals.
- Preserved existing replication behavior after initial sync completed.
- Reduced server workload by avoiding repeated permission-filtered `_changes` requests.
- Maintained compatibility with existing offline user databases.

## Related Files

- webapp/src/js/bootstrapper/initial-replication.js
- api/src/controllers/replication.js
- api/src/services/replication/replication.js

## Testing

- Verified users received all required documents and no extra documents.
- Confirmed download counters behaved correctly.
- Tested replication restart after browser refresh and network interruptions.
- Verified upgrades did not trigger unnecessary re-syncs.
- Tested replication with attachment-heavy datasets and poor network conditions.

## Related Issues

- #8296: Refactor downwards continuous replication following the Nairobi protocol
- #8184: Update initial replication scalability suite post initial replication rewrite
- #7528: Improve initial replication
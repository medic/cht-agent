---
id: cht-core-5235
category: bug
domain: data-sync
subDomain: replication
issueNumber: 5235
issueUrl: https://github.com/medic/cht-core/issues/5235
title: Interrupted replication fails because of seq_interval changes parameter
lastUpdated: 2019-01-17
summary: Replication could fail after interruptions when older PouchDB clients replicated against newer CHT versions because the seq_interval parameter was incorrectly forwarded to CouchDB changes requests.
services:
  - api
  - webapp
techStack:
  - javascript
  - couchdb
  - pouchdb
---

## Problem

Offline users could experience replication failures after network interruptions, particularly when upgrading from older CHT versions. Replication checkpoints were saved incorrectly, causing synchronization to become unreliable or incomplete.

## Root Cause

PouchDB 6.4.x automatically sent the `seq_interval` parameter in replication requests. CHT API forwarded this parameter to CouchDB `_changes` requests during filtered replication.

When `_changes` was combined with `seq_interval`, `limit`, and `_doc_ids` filters, CouchDB returned sequence numbers in unexpected positions. PouchDB then stored incorrect checkpoint values, causing replication to restart from the wrong location after interruptions.

## Solution

The fix was to stop forwarding the `seq_interval` parameter from API to CouchDB upstream `_changes` requests.

This prevented incorrect sequence handling and allowed replication checkpoints to be written correctly, even when replication was interrupted and resumed.

## Code Patterns

- Be careful when proxying CouchDB request parameters through custom APIs.
- Replication checkpoint correctness is critical for offline-first applications.
- New parameters introduced by database libraries should be validated before forwarding.
- Changes-feed behavior must be tested across CouchDB and PouchDB versions.

## Design Choices

- Chose to remove forwarding of `seq_interval` rather than implementing custom sequence handling.
- Kept behavior compatible with both older and newer PouchDB clients.
- Preferred a minimal API-side fix instead of modifying replication logic throughout the application.

## Related Files

- api replication endpoint handling
- changes request proxy logic
- CouchDB `_changes` integration code

## Testing

- Tested upgrading from CHT 2.18 to 3.2.x.
- Simulated interrupted replication by repeatedly disconnecting and reconnecting clients.
- Verified that replication completed successfully and checkpoints were stored correctly.
- Confirmed offline users could continue syncing after upgrades.

## Related Issues

- #5236: Don't forward seq_interval in upstream Changes requests
- #5237: Don't forward seq_interval to CouchDB
- #5247: Upgrading from 2.18 to 3.2 is not triggering the update dialog
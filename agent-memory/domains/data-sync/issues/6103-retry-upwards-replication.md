---
id: cht-core-6103
category: improvement
domain: data-sync
subDomain: upwards-replication
issueNumber: 6103
issueUrl: https://github.com/medic/cht-core/issues/6103
title: Retry upwards replication for temporarily forbidden documents
lastUpdated: 2019-12-13
summary: Added automatic retry logic for documents that are temporarily rejected during upwards replication because dependent documents have not yet been uploaded.
services:
  - webapp
  - api
techStack:
  - javascript
  - couchdb
  - pouchdb
---

## Problem

Offline users could create a new contact and reports related to that contact while disconnected.

When synchronization occurred, PouchDB uploaded documents in batches. Sometimes a report was uploaded before the contact it depended on.

The API correctly rejected the report because the referenced contact did not yet exist on the server. The report remained unsynced even though it would become valid once the contact was uploaded.

## Root Cause

PouchDB uploads documents in batches of 100.

If a contact and its related reports ended up in different batches, the report batch could be processed first.

The API validates whether users are allowed to create reports for the referenced contact. Since the contact did not yet exist on the server, the report was denied.

Previously, denied documents were not automatically retried.

## Solution

Added logic to listen for PouchDB's `denied` replication event.

When a document is denied because of a temporary dependency issue, the webapp "touches" the document, creating a new revision.

This moves the document to the end of the changes feed so it can be retried after dependent documents have been uploaded successfully.

## Code Patterns

- Upwards replication should be resilient to document ordering problems.
- Temporary replication failures should be retried automatically.
- PouchDB replication events can be used to detect and recover from failed uploads.
- Creating a new revision is a simple way to re-queue a document for replication.

## Design Choices

- Chose automatic retries instead of requiring manual user intervention.
- Reused PouchDB's existing denied event mechanism.
- Avoided introducing custom replication queues or dependency tracking.
- Limited retries to prevent permanently invalid documents from looping forever.

## Related Files

- webapp/src/ts/services/db-sync.service.ts
- webapp/src/ts/services/db-sync-retry.service.ts

## Testing

- Created a contact and more than 100 reports linked to that contact.
- Verified reports were initially denied when uploaded before the contact.
- Verified reports synchronized successfully on subsequent sync attempts.
- Tested that permanently forbidden documents were not retried indefinitely.

## Related Issues

- #6151: Retries forbidden doc replication
- #7709: Support replacing offline users from offline device
- #8186: Add visibility to documents that were denied from upwards replication
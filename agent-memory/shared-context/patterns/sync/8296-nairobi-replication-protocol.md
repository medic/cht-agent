---

id: cht-core-8296
category: improvement
domain: data-sync
subDomain: replication
issueNumber: 8296
issueUrl: https://github.com/medic/cht-core/issues/8296
title: Refactor downwards continuous replication following the Nairobi protocol
lastUpdated: 2023-07-28
summary: Replaced the existing filtered replication mechanism with the Nairobi replication protocol, reducing expensive database queries, simplifying synchronization logic, and enabling support for CouchDB shard replicas.
services:

* api
* webapp
  techStack:
* javascript
* couchdb
* pouchdb

---

## Problem

The existing downwards continuous replication process relied on a combination of CouchDB views, filtered replication, and changes feed requests. This required multiple expensive database queries and introduced complexity into the synchronization process.

The approach also depended on tombstone documents for tracking deletions and made it difficult to support CouchDB shard replicas because multiple related requests needed to hit the same database node.

## Root Cause

The replication algorithm combined custom filtering logic with standard CouchDB replication APIs. For each synchronization cycle, the client needed to:

* Query views to determine accessible document IDs
* Request changes feeds for those documents
* Track deleted documents through tombstones

As deployments grew larger, these operations became increasingly expensive and harder to scale.

## Solution

Introduced the Nairobi replication protocol as a replacement for the previous downwards continuous replication mechanism.

The new workflow is:

1. Client uploads locally modified documents.
2. Client requests all document IDs and revisions it should have access to.
3. Client compares server revisions against local PouchDB revisions.
4. Missing or outdated documents are downloaded.
5. Documents that no longer exist or are no longer accessible are removed from local storage after verification.

This approach eliminates the need for filtered changes feed replication and significantly simplifies synchronization.

## Code Patterns

* Prefer document ID and revision comparison over filtered changes feed replication.
* Use dedicated synchronization APIs instead of chaining multiple CouchDB view and changes requests.
* Design replication flows to work independently of CouchDB tombstones whenever possible.
* Replication protocols should support distributed database deployments and shard replicas.

## Design Choices

* Chose revision-based synchronization because it scales better than repeatedly querying filtered changes feeds.
* Removed dependence on tombstones to simplify document cleanup and replication logic.
* Eliminated the need for sticky sessions, making CouchDB shard replicas feasible.
* Reduced complexity by consolidating synchronization behavior into a single replication protocol.

## Related Files

* API replication endpoints implementing the Nairobi protocol
* Webapp synchronization services
* Client-side replication logic
* PR #8314

## Testing

* Verified initial and continuous replication behavior.
* Confirmed new server-side documents continue to synchronize correctly.
* Tested browser refresh and network interruption scenarios.
* Verified replication of documents with attachments.
* Confirmed upgraded clients continue syncing without unnecessary full replications.

## Related Issues

* #8134: Refactor initial replication to not use PouchDB replicate
* #7893: Ability to use CouchDB shard replicas
* #8037: Update client-side purging to trigger task recalculation
* #8303: Sync Now reports success even if replication fails due to timeout

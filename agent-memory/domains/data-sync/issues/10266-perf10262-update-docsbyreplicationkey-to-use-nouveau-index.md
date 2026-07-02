---
id: cht-core-10262
category: improvement
domain: data-sync
domainFit: strong
issueNumber: 10262
issueUrl: https://github.com/medic/cht-core/issues/10262
title: Replace docs_by_replication_key CouchDB view with a Nouveau (Lucene) index to speed up replication authorization queries
lastUpdated: '2026-06-22'
summary: Replication authorization relied on the docs_by_replication_key CouchDB view queried with large multi-key payloads, the most costly part of replication. This PR adds a parallel Nouveau index for the same data and switches API/sentinel code to query the index instead of the view, improving replication performance.
services:
  - api
  - sentinel
techStack:
  - javascript
  - typescript
  - couchdb
  - nouveau
  - lucene
tags:
  - replication
  - performance
  - nouveau
  - couchdb-views
  - docs_by_replication_key
  - authorization
  - indexing
related_workflows:
  - nouveau-search
source_pr: medic/cht-core#10266
source_sha: ec11cc604faabe87337e6a80e1642bb135c13aff
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/authorization.js
  - ddocs/medic-db/medic/nouveau/docs_by_replication_key/index.js
  - ddocs/medic-db/medic/views/docs_by_replication_key/map.js
  - shared-libs/nouveau/src/index.js
  - sentinel/src/lib/purging.js
concepts:
  - replication authorization
  - Nouveau full-text indexing
  - CouchDB views vs Lucene indexes
  - offline-first replication
  - multi-key view query performance
related_issues: []
stale: false
---

## Problem

Replication requires querying the docs_by_replication_key CouchDB view, often with a large payload of keys proportional to the number of contacts a user can see. CouchDB is inefficient at searching views by many keys at once, making these queries the most costly part of replication and slowing sync for users with large contact hierarchies.

## Root Cause

CouchDB map/reduce views are not optimized for multi-key lookups; querying docs_by_replication_key with many replication keys forces repeated, inefficient B-tree lookups whose cost scales with the number of documents/contacts a user is authorized to replicate.

## Solution

Added a Nouveau (Lucene-backed) index mirroring the docs_by_replication_key view under ddocs/medic-db/medic/nouveau/docs_by_replication_key (index.js + default_analyzer) and updated the API authorization service and sentinel purging to query the Nouveau index instead of the view. Extended the shared nouveau and view-map-utils libraries to support the new index and updated config-watcher accordingly, retaining the original view map.js for compatibility.

## Code Patterns

Pattern for replacing an expensive multi-key CouchDB view query with a Nouveau full-text index: define a parallel index at ddocs/medic-db/medic/nouveau/<name>/index.js with a default_analyzer, extend shared-libs/nouveau/src/index.js to expose querying it, and switch consuming services (api/src/services/authorization.js, sentinel/src/lib/purging.js) over while keeping the legacy view (views/<name>/map.js) for backwards compatibility. shared-libs/view-map-utils centralizes the view/index mapping helpers.

## Design Choices

Chose a Nouveau (Lucene) index over further tuning the CouchDB view because Lucene handles large multi-term/key queries far more efficiently than CouchDB's multi-key view lookups. The existing view map.js was kept alongside the new index to preserve the data shape and remain backwards compatible during rollout.

## Related Files

- api/src/services/authorization.js
- api/src/services/config-watcher.js
- ddocs/medic-db/medic/nouveau/docs_by_replication_key/index.js
- ddocs/medic-db/medic/nouveau/docs_by_replication_key/default_analyzer
- ddocs/medic-db/medic/views/docs_by_replication_key/map.js
- sentinel/src/lib/purging.js
- shared-libs/nouveau/src/index.js
- shared-libs/view-map-utils/src/view-map-utils.js
- shared-libs/cht-datasource/src/local/libs/request-utils.ts

## Testing

Updated unit tests for api authorization and config-watcher, sentinel purging, and the shared nouveau and view-map-utils libraries. Added/updated integration coverage including tests/integration/couchdb/views/docs-by-replication-key.spec.js, a dedicated replication runner (.mocharc-replication.js) wired into specs.js, plus users and server integration specs; an enketo-widgets e2e spec was also touched.

## Related Issues

- #10262: docs_by_replication_key view queries with large multi-key payloads are the most costly part of replication (performance investigation)

## Domain Rationale

**Fit:** strong

The PR optimizes the docs_by_replication_key query that drives replication authorization — deciding which documents sync to each user — which is the canonical heart of the data-sync domain. Although it adds a Nouveau index (a data-layer internal), it is squarely in service of replication/sync rather than a generic indexing tweak, so the fit is strong.

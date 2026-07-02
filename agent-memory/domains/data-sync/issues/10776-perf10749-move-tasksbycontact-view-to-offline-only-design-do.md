---
id: cht-core-10749
category: improvement
domain: data-sync
domainFit: strong
issueNumber: 10749
issueUrl: https://github.com/medic/cht-core/issues/10749
title: Move tasks_by_contact view from server-indexed medic-client ddoc to an offline-only design document to eliminate wasteful CouchDB server indexing
lastUpdated: '2026-06-22'
summary: The high-volume tasks_by_contact view was being indexed on the CouchDB server even though only offline clients' rules engine queries it, wasting disk and CPU on large deployments. The PR moves the view to a new offline-only design document (medic-offline-tasks) so it is only built on client-side PouchDB.
services:
  - webapp
  - api
techStack:
  - couchdb
  - pouchdb
  - javascript
  - mapreduce
tags:
  - performance
  - offline-first
  - couchdb-views
  - design-documents
  - rules-engine
  - server-indexing
related_workflows:
  - task-scheduling
source_pr: medic/cht-core#10776
source_sha: 263c67d1daf3ebcb26f4eb4ae87fcc65394dc721
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/bootstrapper/offline-ddocs/medic-offline-tasks/tasks_by_contact.js
  - webapp/src/js/bootstrapper/offline-ddocs/medic-offline-tasks/index.js
  - webapp/src/js/bootstrapper/offline-ddocs/index.js
  - shared-libs/rules-engine/src/pouchdb-provider.js
  - shared-libs/memdown/src/memdown-medic.js
  - _design/medic-offline-tasks
  - _design/medic-client
  - tasks_by_contact
concepts:
  - offline-first architecture
  - CouchDB design documents
  - server-side vs client-side view indexing
  - offline-only design documents
  - map-reduce view maintenance cost
  - design-document replication topology
  - rules engine data provider
related_issues: []
stale: false
---

## Problem

The tasks_by_contact view lived in the medic-client design document, so the CouchDB server built and stored its index. Tasks are high-volume (thousands of documents), and every task document write forced the server to update this index, consuming significant disk space and processing power. The index is only ever queried by the offline rules engine on mobile/web clients, so this server-side work provided zero benefit and slowed the database server, hurting performance on larger deployments.

## Root Cause

tasks_by_contact was defined in a server-indexed/replicated design document (medic-client). CouchDB maintains every view in such a ddoc on the server on each relevant document update, so a client-only index incurred continuous server-side indexing cost despite having no server-side consumer.

## Solution

Moved the tasks_by_contact view definition out of medic-client into a new offline-only design document (_design/medic-offline-tasks) registered through the webapp bootstrapper's offline-ddocs system, so the view is created and indexed only on the client's local PouchDB. Updated @medic/rules-engine's pouchdb-provider to query the relocated _design/medic-offline-tasks/tasks_by_contact location, removed the redundant view from the server-side medic-client ddoc, and updated the @medic/memdown test harness to load the offline-only views for integration testing.

## Code Patterns

Offline-ddocs pattern for client-only indexes: place views needed solely by offline clients under webapp/src/js/bootstrapper/offline-ddocs/<ddoc-name>/ so they are provisioned on client PouchDB and never indexed server-side. Each offline ddoc has an index.js (e.g. medic-offline-tasks/index.js) registering its views and a per-view module (tasks_by_contact.js) exporting the map function; register the ddoc in offline-ddocs/index.js. Consumers (here shared-libs/rules-engine/src/pouchdb-provider.js) must query the new _design name. The @medic/memdown harness (shared-libs/memdown/src/memdown-medic.js) must also load these offline-only views so integration tests mirror the client database.

## Design Choices

Relocated the view to an offline-only ddoc rather than leaving it in medic-client, because the index has no server-side consumer — only the offline rules engine reads it — so server indexing is pure waste. This removes server cost while preserving identical offline behavior. Reviewer (witash) confirmed it would be 'a huge improvement on larger deployments' and required the branch be scoped strictly to the issue, removing an unrelated authorization.js change and unrelated flaky-test fixes (those belong on their own branch).

## Related Files

- webapp/src/js/bootstrapper/offline-ddocs/medic-offline-tasks/tasks_by_contact.js
- webapp/src/js/bootstrapper/offline-ddocs/medic-offline-tasks/index.js
- webapp/src/js/bootstrapper/offline-ddocs/index.js
- shared-libs/rules-engine/src/pouchdb-provider.js
- shared-libs/memdown/src/memdown-medic.js
- shared-libs/rules-engine/test/integration.spec.js
- shared-libs/rules-engine/test/pouchdb-provider.spec.js
- shared-libs/rules-engine/test/provider-wireup.spec.js
- tests/e2e/default/db/initial-replication.wdio-spec.js

## Testing

Rules engine integration tests (220 passing) verify queries hit the new offline ddoc location; pouchdb-provider.spec.js, provider-wireup.spec.js and integration.spec.js were updated, and the @medic/memdown test harness (memdown-medic.js) was updated to load the new offline-only views. The e2e initial-replication test (tests/e2e/default/db/initial-replication.wdio-spec.js) was updated to reflect the offline ddoc replication. Manual bootstrapper verification was also performed. Note: reviewer flagged lint failures (npm run lint) to resolve before merge.

## Related Issues

- #10749: tasks_by_contact high-volume view causing wasteful CouchDB server-side indexing and slowing the database on larger deployments

## Domain Rationale

**Fit:** strong

The PR's core is the offline-first replication topology — relocating a CouchDB view from the server-indexed/replicated medic-client design document to an offline-only design document built only on client PouchDB via the bootstrapper's offline-ddocs and initial-replication system. Although the view (tasks_by_contact) feeds the rules engine (a tasks-and-targets concern), the change is about where indexes are replicated and built across the server↔offline-client boundary, not about task behavior; the rules-engine edit is just a pointer update to follow the moved ddoc.

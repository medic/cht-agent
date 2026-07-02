---
id: cht-core-9691
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 9691
issueUrl: https://github.com/medic/cht-core/issues/9691
title: 'Plug Nouveau search APIs into the API install/upgrade lifecycle: warm Nouveau indexes alongside CouchDB views and clean up stale indexes during setup'
lastUpdated: '2026-06-22'
summary: Nouveau (Lucene-based) full-text search indexes were not integrated into the API install/upgrade lifecycle the way CouchDB views are, so they were neither warmed during upgrade nor cleaned up when stale. This PR teaches the setup services (view-indexer, check-install, utils) and db helpers to warm and clean up Nouveau indexes as part of the same lifecycle.
services:
  - api
techStack:
  - nodejs
  - javascript
  - couchdb
  - nouveau
  - lucene
  - mocha
tags:
  - nouveau
  - search
  - view-indexer
  - index-warming
  - api-lifecycle
  - setup
  - upgrade
  - couchdb
  - stale-index-cleanup
related_workflows:
  - nouveau-search
  - observability
source_pr: medic/cht-core#9717
source_sha: 16cd5af10222bf70af28044358bd3ac2aa915893
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/db.js
  - api/src/services/setup/view-indexer.js
  - api/src/services/setup/check-install.js
  - api/src/services/setup/utils.js
concepts:
  - index warming
  - API install/upgrade lifecycle
  - Nouveau full-text search
  - view indexing
  - stale index cleanup
  - indexing-progress tracking via _active_tasks
related_issues: []
stale: false
---

## Problem

With the introduction of CouchDB Nouveau (Lucene-based full-text search), Nouveau search indexes existed but were not wired into the API's install/upgrade lifecycle. Unlike CouchDB views — which the view-indexer warms during setup so the first queries aren't slow — Nouveau indexes were not warmed during upgrade and stale Nouveau indexes were not cleaned up, leaving search-index builds to happen lazily/inconsistently after an upgrade.

## Root Cause

The API setup services (view-indexer.js, check-install.js, utils.js) and the central db.js only understood CouchDB design-doc views; the Nouveau APIs were never plugged into the setup/upgrade lifecycle, and db.js lacked helpers to enumerate and query Nouveau indexes. Issue #9691 also flagged an outstanding cleanup TODO in setup/utils.js.

## Solution

Extended the API setup lifecycle to manage Nouveau indexes: added Nouveau DB access helpers in api/src/db.js (mirroring the existing view helpers), taught api/src/services/setup/view-indexer.js to warm Nouveau search indexes alongside CouchDB views (tracking indexing progress), updated api/src/services/setup/check-install.js to account for Nouveau when verifying an install, and added cleanup of stale Nouveau indexes in api/src/services/setup/utils.js (resolving the cleanup item from #9691).

## Code Patterns

Index warming during setup reuses the existing view-indexer pattern — enumerate the design docs/indexes, trigger a build query against each, and poll for completion (CouchDB GET /_active_tasks) — now generalized to cover Nouveau search indexes in api/src/services/setup/view-indexer.js. Nouveau DB-access helpers are centralized in api/src/db.js so the setup services don't talk to the Nouveau endpoint directly, mirroring how view helpers are exposed.

## Design Choices

Reused the existing view-indexer warming/cleanup lifecycle instead of building a separate Nouveau-specific path, so Nouveau indexes are warmed and pruned alongside CouchDB views within the same install/upgrade flow; stale-index cleanup was added to the existing setup/utils.js cleanup step rather than a new module.

## Related Files

- api/src/db.js
- api/src/services/setup/check-install.js
- api/src/services/setup/utils.js
- api/src/services/setup/view-indexer.js
- api/tests/mocha/db.spec.js
- api/tests/mocha/services/setup/utils.spec.js
- api/tests/mocha/services/setup/view-indexer.spec.js

## Testing

Added/updated mocha unit tests covering the new lifecycle behavior: api/tests/mocha/db.spec.js (Nouveau DB helpers), api/tests/mocha/services/setup/utils.spec.js (stale Nouveau index cleanup), and api/tests/mocha/services/setup/view-indexer.spec.js (Nouveau index warming during setup).

## Related Issues

- #9691: Improve Nouveau lifecycle handling — warm Nouveau indexes and track indexing progress during upgrade steps, and clean up stale indexes in setup/utils.js

## Domain Rationale

**Fit:** strong

The change modifies the API setup/install/upgrade lifecycle machinery (view-indexer, check-install, setup utils, db helpers) to warm and clean up Nouveau search indexes during startup/upgrade — operational upgrade tooling that directly parallels other API-upgrade-lifecycle work (e.g. 'skip CouchDB compaction during API upgrade'). It plugs Nouveau into the lifecycle rather than altering Nouveau index design docs or search query behavior, so it is a strong infrastructure fit rather than data-sync.

---
id: cht-core-9691
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9691
issueUrl: https://github.com/medic/cht-core/issues/9691
title: 'Plug Nouveau search APIs into the API install/upgrade lifecycle: warm Nouveau indexes alongside CouchDB views and clean up stale indexes during setup'
lastUpdated: '2026-10-01'
summary: Nouveau (Lucene-based) full-text search indexes were not integrated into the API install/upgrade lifecycle the way CouchDB views are, so they were neither warmed during upgrade nor cleaned up when stale. This PR makes the setup view-indexer warm the Nouveau indexes of staged design docs and makes the setup `cleanup` step call a new `nouveauCleanup` helper in api/src/db.js, so Nouveau indexes are warmed and cleaned up as part of the same lifecycle.
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
  - api/src/services/setup/utils.js
concepts:
  - index warming
  - API install/upgrade lifecycle
  - Nouveau full-text search
  - view indexing
  - stale index cleanup
  - Nouveau index cleanup (_nouveau_cleanup)
related_issues:
  - cht-core-9690
  - cht-core-9882
  - cht-core-9542
stale: true
---

> **Epic child.** PR #9717 was squash-merged into the feature branch `9542_freetext_tco`
> (`16cd5af10`, 2025-05-07), not into master. That branch reached master as PR #10201
> (`f1bdfc07c`, 2025-08-22). Its own PR number is stamped nowhere on master, and this
> draft's `source_sha` is not on master. To resolve it, run
> `git fetch origin +refs/pull/10201/head:refs/verify/pr10201` — the epic PR's head ref.

## Problem

With the introduction of CouchDB Nouveau (Lucene-based full-text search), Nouveau search indexes existed but were not wired into the API's install/upgrade lifecycle. Before this PR, unlike CouchDB views — which the view-indexer warms during setup so the first queries aren't slow — Nouveau indexes were not warmed during upgrade and stale Nouveau indexes were not cleaned up.

## Root Cause

At this PR's parent, `getViewsToIndex` in api/src/services/setup/view-indexer.js queued a query only for each entry in a staged ddoc's `views`, and `cleanup` in api/src/services/setup/utils.js ran only `compact()` and `viewCleanup()` on each database; nothing in the setup services called CouchDB's Nouveau query or cleanup endpoints. Issue #9691 named those two places — the upgrade step that indexes staged views, and `cleanup` in api/src/services/setup/utils.js — as where Nouveau should be plugged in.

## Solution

Extended the API setup lifecycle to manage Nouveau indexes. api/src/db.js gained `nouveauCleanup`, which POSTs `${environment.couchUrl}/_nouveau_cleanup` (the medic database's Nouveau cleanup endpoint) and is listed in `GLOBAL_FUNCTIONS_TO_STUB`; `cleanup` in api/src/services/setup/utils.js now also calls `db.nouveauCleanup()`, logging any error (resolving the cleanup item from #9691). In api/src/services/setup/view-indexer.js, `getViewsToIndex` now also queues an `indexNouveauIndex` call for every key of a staged ddoc's `nouveau` property; `indexNouveauIndex` queries `${environment.serverUrl}/${dbName}/${ddocId}/_nouveau/${indexName}` with `qs: { q: '*:*', limit: 1 }`, and it and `indexView` share a new `waitForRequest` helper that retries on socket-timeout errors while indexing continues. Both the upgrade path and the startup install check reach this through `upgradeSteps.indexStagedViews()`, so api/src/services/setup/check-install.js needed no logic change — the PR only removed two blank lines from it. The issue's optional ask to track indexing progress via `GET /_active_tasks` was not part of this PR: at this PR, api/src/services/setup/view-indexer-progress.js still keeps only tasks with `task.type === 'indexer'`, so Nouveau `search_indexer` tasks are not reported; on master they were added by PR #10301 (`8277669a0`).

## Code Patterns

Index warming during setup reuses the existing view-indexer pattern — enumerate the staged design docs and issue a minimal query against each index (`qs: { limit: 1 }` for a view, `qs: { q: '*:*', limit: 1 }` for a Nouveau index) that returns once the index is built, retrying through `waitForRequest` on socket timeouts — now generalized to cover Nouveau search indexes in api/src/services/setup/view-indexer.js. The cleanup call lives in api/src/db.js as `nouveauCleanup`, next to server-level helpers such as `activeTasks`, and is listed in `GLOBAL_FUNCTIONS_TO_STUB` so unit tests must stub it; the warming query itself is issued directly from api/src/services/setup/view-indexer.js.

## Design Choices

Reused the existing view-indexer warming/cleanup lifecycle instead of building a separate Nouveau-specific path, so Nouveau indexes are warmed and pruned alongside CouchDB views within the same install/upgrade flow; the existing `cleanup` step in api/src/services/setup/utils.js took on the stale-index cleanup rather than a separate module.

## Related Files

- api/src/db.js
- api/src/services/setup/check-install.js
- api/src/services/setup/utils.js
- api/src/services/setup/view-indexer.js
- api/tests/mocha/db.spec.js
- api/tests/mocha/services/setup/utils.spec.js
- api/tests/mocha/services/setup/view-indexer.spec.js

## Testing

The existing mocha specs gained cases for the Nouveau lifecycle behavior: api/tests/mocha/db.spec.js has a `nouveau cleanup` block asserting that `nouveauCleanup` POSTs to `http://admin:pass@couch:5984/medic/_nouveau_cleanup` (the spec stubs `couchUrl` as `http://admin:pass@couch:5984/medic`); api/tests/mocha/services/setup/utils.spec.js expects `cleanup` to call `db.nouveauCleanup` and gains `should catch nouveau cleanup errors and log them`; and api/tests/mocha/services/setup/view-indexer.spec.js adds a staged ddoc with `nouveau: { index1: {} }` and expects its `_nouveau/index1` query with `qs: { limit: 1, q: '*:*' }` among seven indexing requests.

## Related Issues

- #9691: "Plug Nouveau APIs with API lifecycle" — this PR's issue; it asked to warm Nouveau indexes (and, marked "maybe?", track indexing progress via `GET /_active_tasks`) in the upgrade steps and to clean them up in `cleanup` in api/src/services/setup/utils.js
- #9690: "Add Nouveau indexes' info in our monitoring API" — companion Nouveau issue; PR #9700 added Nouveau index info to the monitoring API
- #9882: "Upgrade to latest version of Couch/Nouveau to 3.5.0" — waited on this issue's lifecycle code so that the image upgrade (PR #9960) could validate upgrading an instance that already has Nouveau indexes
- #9542: "Reduce disk space with CouchDB Nouveau (TCO v1)" — the Nouveau epic this PR was delivered under

## Domain Rationale

**Fit:** strong

Every source change is in the API's install/upgrade machinery: api/src/services/setup/view-indexer.js warms the Nouveau indexes of staged design docs before they go live, and `cleanup` in api/src/services/setup/utils.js cleans up stale Nouveau indexes through `db.nouveauCleanup()` from api/src/db.js. That is upgrade tooling for the database tier; the PR changes neither the Nouveau index definitions under `ddocs/` nor the code that serves user searches.

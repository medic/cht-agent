---
id: cht-core-9690
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9690
issueUrl: https://github.com/medic/cht-core/issues/9690
title: Expose Nouveau full-text search metrics via the /api/v2/monitoring observability endpoint
lastUpdated: '2026-10-05'
summary: The monitoring API exposed health metrics for components like CouchDB and Sentinel but had no visibility into the Nouveau search engine. This PR extends the monitoring service to fetch `_nouveau_info` for the medic database's two freetext indexes and report each one's name, `num_docs` and `disk_size` under `nouveau_indexes`. The design doc and output field names changed before this work reached master; see the stale-as-written banner.
services:
  - api
techStack:
  - nodejs
  - javascript
  - couchdb
  - nouveau
  - lucene
tags:
  - monitoring
  - observability
  - nouveau
  - metrics
  - health-check
  - search
related_workflows:
  - observability
  - nouveau-search
source_pr: medic/cht-core#9700
source_sha: db53828bb59759802e3d2408bd4198c226312046
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/monitoring.js
concepts:
  - observability endpoint
  - metrics collection
  - operational health monitoring
  - full-text search index health
related_issues:
  - cht-core-9691
  - cht-core-9542
stale: true
---

> **Epic child.** PR #9700 was squash-merged into the feature branch `couchdb-nouveau`
> (`db53828bb`, 2024-12-16), not into master. That branch was squashed into
> `9542_freetext_tco` by PR #9541 (`8736d059f`, 2025-04-07), which reached master as
> PR #10201 (`f1bdfc07c`, 2025-08-22). Its own PR number is stamped nowhere on master, and this
> draft's `source_sha` is not on master. To resolve it, run
> `git fetch origin +refs/pull/9541/head:refs/verify/pr9541` — the head ref of PR #9541, whose
> `couchdb-nouveau` branch contains the anchor.
>
> **Renamed before landing (`stale-as-written`):** later commits on the `couchdb-nouveau` branch,
> before PR #9541 squashed it, changed what this PR wrote. `dc26de237` moved the freetext
> indexes from the `medic-nouveau` design doc (`ddocs/medic-db/medic-nouveau/nouveau/` at this PR)
> into `medic` (`ddocs/medic-db/medic/nouveau/` at `f1bdfc07c`), and `137d23b93` re-keyed
> `NOUVEAU_INDEXES_TO_MONITOR` from `'medic-nouveau'` to `'medic'`. Then `5df093f8f` renamed the
> `nouveau_indexes` entry fields `num_docs` / `disk_size` to `doc_count` / `file_size`, made
> `fetchNouveauIndexInfo` set `name` to `` `${designDoc}/${indexName}` `` instead of reading it
> from the `_nouveau_info` response, and added empty `sentinel`, `usersmeta` and `users` entries,
> so those databases report `nouveau_indexes: []` rather than `undefined`. That is the form
> PR #10201 carried to master. On master, `docs_by_replication_key` was added to the monitored
> indexes by PR #10496 (`544bd9a3f`). Identifiers below are as of this PR.

## Problem

Before this PR, the /api/v2/monitoring endpoint, which operators and monitoring systems scrape to observe instance health, reported no metrics about the Nouveau full-text search engine. Operators therefore had no visibility into Nouveau's state through the standard observability surface.

## Root Cause

At this PR's parent, the monitoring service (api/src/services/monitoring.js) aggregated metrics only for existing components and contained no logic to query and surface Nouveau search-index metrics in the monitoring response payload.

## Solution

Extended the monitoring service to collect Nouveau metrics and merge them into the aggregated /api/v2/monitoring response, alongside the existing component metrics. At this PR, `NOUVEAU_INDEXES_TO_MONITOR` lists `contacts_by_freetext` and `reports_by_freetext` under the `medic-nouveau` design doc of the `medic` database; `fetchNouveauIndexInfo` GETs `${environment.serverUrl}/${db}/_design/${designDoc}/_nouveau_info/${indexName}` for each, logging a failed request and returning `null`, which `fetchNouveauIndexInfosForDb` filters out. `getDbInfos` runs `fetchAllNouveauIndexInfos()` alongside the database and view-index fetches, and `mapDbInfo` gained a `nouveauIndexInfos` argument from which it emits `nouveau_indexes` entries of `name`, `num_docs` and `disk_size`. Because `jsonV2` builds on `jsonV1`, the deprecated /api/v1/monitoring reports the same data. Unit and integration tests cover the Nouveau output, and the test harness's `startServices` in tests/utils/index.js gained `env.COUCHDB_NOUVEAU_DATA = makeTempDir('ci-nouveaudata');`, a temporary directory for the `COUCHDB_NOUVEAU_DATA` volume that scripts/build/cht-couchdb-single-node.yml.template and scripts/build/cht-couchdb-cluster.yml.template already mount at `/data/nouveau`. Later on the `couchdb-nouveau` branch, `c7e90c03d` repointed both templates' Nouveau volume to a `nouveau` directory under `COUCHDB_DATA` (single node) or `DB1_DATA` (cluster), and `aa6ba36eb` removed this harness line. PR #9845 (`50cb4bc76`) added it back on `9542_freetext_tco`, but on master nothing mounts the `COUCHDB_NOUVEAU_DATA` directory that `startServices` creates.

## Code Patterns

Extend the metrics aggregation in api/src/services/monitoring.js by adding a dedicated collector for a component and merging its result into the single monitoring response object; back it with unit tests in api/tests/mocha/services/monitoring.spec.js and integration tests in tests/integration/api/controllers/monitoring.spec.js, with tests/utils/index.js supplying a temporary Nouveau data directory for the test CouchDB. `getDbInfos` pairs `nouveauIndexInfos[i]` with the `DBS_TO_MONITOR` key at the same position, so `NOUVEAU_INDEXES_TO_MONITOR` has to list its databases in that order; at this PR only `medic` (position 0) is listed.

## Design Choices

Surface Nouveau metrics through API's existing monitoring service and its /api/v2/monitoring endpoint, as #9690 asked ("track any existing Nouveau indexes in API's monitoring service"), so the data reaches the observability dashboard alongside the metrics already reported for other components.

## Related Files

- api/src/services/monitoring.js
- api/tests/mocha/services/monitoring.spec.js
- tests/integration/api/controllers/monitoring.spec.js
- tests/utils/index.js

## Testing

The existing api/tests/mocha/services/monitoring.spec.js gained assertions that the v1 and v2 service output carries `nouveau_indexes` for the medic database (and `[]` when the `_nouveau_info` requests fail), and that the `_nouveau_info` URLs are requested. At this PR, the existing tests/integration/api/controllers/monitoring.spec.js expects `nouveau_indexes` entries built from `NOUVEAU_INDEXES_BY_DB` (`'medic-nouveau': ['contacts_by_freetext', 'reports_by_freetext']`) and named `_design/${ddocName}/${indexName}`, from both /api/v1/monitoring and /api/v2/monitoring, treating `disk_size` and `num_docs` as indeterminate fields. tests/utils/index.js only gained the `COUCHDB_NOUVEAU_DATA` temporary directory.

## Related Issues

- #9690: "Add Nouveau indexes' info in our monitoring API" — this PR's issue; it asked for the `GET /{db}/_design/{ddoc}/_nouveau_info/{index}` data to reach the observability dashboard
- #9691: "Plug Nouveau APIs with API lifecycle" — companion Nouveau issue, delivered on the `9542_freetext_tco` epic branch by PR #9717, which made API setup wait for the Nouveau indexes of staged design docs and clean up stale ones
- #9542: "Reduce disk space with CouchDB Nouveau (TCO v1)" — the Nouveau epic; #9690 cites it as the upcoming CouchDB Nouveau implementation whose indexes need monitoring

## Domain Rationale

**Fit:** strong

The change is confined to the API's monitoring service, its tests and the test harness: api/src/services/monitoring.js starts reading CouchDB's `_nouveau_info` endpoint and reports each freetext index's document count and disk size in the payload that operators and monitoring systems scrape. That is operating the database tier — watching index size and health — and the PR neither defines the Nouveau indexes (no file under `ddocs/` changes) nor alters how searches or replication use them.

---
id: cht-core-11080
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 11080
issueUrl: https://github.com/medic/cht-core/issues/11080
title: Update CouchDB to 3.5.2 for Nouveau fixes/perf, set the Nouveau request_timeout to 1h, and map the test harness's couchdb-nouveau name to the nouveau container so CI logs are saved
lastUpdated: '2026-10-08'
summary: 'CHT was on CouchDB 3.5.0 and had skipped 3.5.1 due to performance issues, missing wanted 3.5.x Nouveau fixes, Nouveau performance improvements, and _purge optimizations. This PR upgrades CouchDB to 3.5.2 across the Docker images, sets the `[nouveau]` `request_timeout` to 1h (the fix for Nouveau requests timing out after 30 seconds, #11153), and makes the test harness map its `couchdb-nouveau` name to the actual `nouveau` container so CI saves Nouveau''s logs.'
services:
  - api
techStack:
  - couchdb
  - docker
  - nouveau
  - javascript
tags:
  - couchdb-upgrade
  - couchdb-3.5.2
  - nouveau
  - performance
  - ci-logs
  - request-timeout
  - docker
  - container-naming
related_workflows:
  - nouveau-search
  - observability
source_pr: medic/cht-core#11162
source_sha: 9cbe335ab2929a0ab658ec355d702a98e4741506
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - couchdb/Dockerfile
  - couchdb-nouveau/Dockerfile
  - couchdb/10-docker-default.ini
  - tests/integration/api/controllers/replication-failure-log.spec.js
  - tests/utils/index.js
concepts:
  - CouchDB database version upgrade
  - Nouveau full-text search engine
  - Docker image versioning / base-image pinning
  - CI container-naming convention for log collection
  - CouchDB ini default configuration (request timeout)
related_issues:
  - cht-core-11153
  - cht-core-6615
stale: false
---

## Problem

Before this PR, CHT ran CouchDB 3.5.0 and had deliberately skipped 3.5.1 because of its performance issues, but in doing so missed desired 3.5.x features: Nouveau bug fixes, Nouveau performance improvements, and _purge optimizations (which #11080 says could enable purging historical data, e.g. #6615). #11080 also wanted 3.5.2's own changes: faster view building, Nouveau bulk index updates and the Nouveau Lucene 10 upgrade. Separately, the Nouveau compose service is named `nouveau` (in scripts/build/cht-couchdb-cluster.yml.template, from which the test harness generates its compose file), while its image is `cht-couchdb-nouveau` and the test harness keys it as `couchdb-nouveau`; under Docker the harness therefore looked for a `<project>-couchdb-nouveau-1` container that does not exist, so that container's logs were never saved, hampering CI debugging. And #11153 reported that CouchDB 3.5.0 connects to Nouveau using the `ibrowse` library, whose 30-second default timeout makes larger Nouveau requests fail with `{ error: 'unknown_error', reason: 'req_timedout' }`.

## Root Cause

At this PR's parent, the CouchDB base image version pinned in couchdb/Dockerfile and couchdb-nouveau/Dockerfile was 3.5.0; `getContainerName` in tests/utils/index.js built the Docker container name straight from the `SERVICES` value (`${project}-${service}-1`), and the Nouveau entry, `'couchdb-nouveau': 'couchdb-nouveau'`, does not match the compose service `nouveau`; and CouchDB 3.5.0 sent Nouveau requests through `ibrowse` with ibrowse's 30-second default timeout, so long-running Nouveau requests failed with `req_timedout`; 3.5.0 read no `[nouveau]` `request_timeout` setting at all (CouchDB added one in 3.5.1, defaulting to 30000 ms), so adding one to the `[nouveau]` section of couchdb/10-docker-default.ini, which set none, would have changed nothing before the upgrade.

## Solution

Bumped the CouchDB base image to 3.5.2 in couchdb/Dockerfile (`FROM couchdb:3.5.2 as base_couchdb_build`) and couchdb-nouveau/Dockerfile (`FROM couchdb:3.5.2-nouveau`, with its `LABEL cht.rebuild` date moved to `2026-06-09`); the existing `[nouveau]` section of couchdb/10-docker-default.ini gained `request_timeout=3600000 ; 1h in ms`; and made `getContainerName` in tests/utils/index.js map any service name that includes `nouveau` to `nouveau`, so under Docker the harness resolves the real `<project>-nouveau-1` container and `saveLogs` captures its logs. No container, compose service or image was renamed. The existing tests/integration/api/controllers/replication-failure-log.spec.js also gained a `utils.clearReplicationFailureLogs()` call in its `before` hook, with its `afterEach` moved up beside it; that diff touches neither the CouchDB version nor container naming.

## Code Patterns

Pin the CouchDB version at the FROM line of couchdb/Dockerfile and couchdb-nouveau/Dockerfile when upgrading; bake CouchDB defaults via couchdb/10-docker-default.ini (e.g. [nouveau] request_timeout); when a compose service is named differently from the name the test harness uses for it (here `nouveau` vs `couchdb-nouveau`), map it in `getContainerName` in tests/utils/index.js, because CI log collection resolves container names from the harness's `SERVICES` map.

## Design Choices

Skipped CouchDB 3.5.1 because of its performance issues and went from 3.5.0 straight to 3.5.2, which #11080 expects to deliver the wanted 3.5.1 changes (Nouveau fixes, Nouveau performance improvements, _purge optimizations) plus 3.5.2's own. Raised the `[nouveau]` `request_timeout` to 3600000 ms (1h) to accommodate long-running Nouveau requests rather than letting them time out — #11153 hit the 30-second limit on `POST /medic/_design/medic/_nouveau/docs_by_replication_key` while purging.

## Related Files

- couchdb/Dockerfile
- couchdb-nouveau/Dockerfile
- couchdb/10-docker-default.ini
- tests/integration/api/controllers/replication-failure-log.spec.js
- tests/utils/index.js

## Testing

No test assertions cover the upgrade, the timeout or the container-name mapping. The existing tests/integration/api/controllers/replication-failure-log.spec.js gained a `utils.clearReplicationFailureLogs()` call in its `before` hook (its `afterEach` cleanup is unchanged, only moved), and the tests/utils/index.js change makes Docker test runs save Nouveau's logs, which they had never captured, improving test-run observability.

## Related Issues

- #11080: "Upgrade to CouchDB 3.5.2" — this PR's issue; it wanted 3.5.1's Nouveau fixes, Nouveau performance improvements and _purge optimizations (3.5.1 itself was skipped for its performance issues) plus 3.5.2's own changes
- #11153: "Nouveau requests timeout after 30 seconds" — also closed by this PR; it reports that CouchDB 3.5.0 talks to Nouveau through `ibrowse`, whose default timeout is 30 seconds; the new `request_timeout=3600000` under `[nouveau]` is this PR's fix for it, and it only takes effect because the PR also upgrades CouchDB, since 3.5.0's `ibrowse` client read no `request_timeout` setting (CouchDB added it in 3.5.1)
- #6615: "Consider moving outdated documents to "cold storage" (Hosting TCO)" — #11080 cites it as the kind of historical-data cleanup that 3.5.x _purge optimizations could make practical

## Domain Rationale

**Fit:** strong

This is a database version bump pinned in Docker images, a Docker-baked CouchDB ini default, and a CI container-naming fix for log collection. The ini change is a CouchDB server default in couchdb/10-docker-default.ini, which couchdb/Dockerfile copies into `/opt/couchdb/etc/default.d/` of CHT's own CouchDB image — not a CHT app setting that projects configure — and the test-harness change only corrects the container name the harness resolves for Nouveau. All of it is build and database-operations work on the images CHT ships.

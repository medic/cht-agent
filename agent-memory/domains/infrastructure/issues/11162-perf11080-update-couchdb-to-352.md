---
id: cht-core-11080
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 11080
issueUrl: https://github.com/medic/cht-core/issues/11080
title: Update CouchDB to 3.5.2 for Nouveau fixes/perf, set nouveau.request_timeout to 1h, and rename the Nouveau container to couchdb-nouveau so CI logs are saved
lastUpdated: '2026-06-22'
summary: CHT was on an older CouchDB and had skipped 3.5.1 due to a performance regression, missing wanted 3.5.x Nouveau fixes, Nouveau performance improvements, and _purge optimizations. This PR upgrades CouchDB to 3.5.2 across the Docker images, raises nouveau.request_timeout to 1h, and renames the misnamed `nouveau` container to `couchdb-nouveau` so CI log collection (which keys off the image-tag naming convention) actually captures its logs.
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
related_issues: []
stale: false
---

## Problem

CHT ran an older CouchDB and deliberately skipped 3.5.1 because of a known performance regression, but in doing so missed desired 3.5.x features: Nouveau bug fixes, Nouveau performance improvements, and _purge optimizations (a prerequisite for purging historical data, #6615). Separately, the Nouveau container was named `nouveau` instead of matching its image tag `couchdb-nouveau`, which broke the CI naming convention so that container's logs were never saved, hampering CI debugging. CouchDB 3.5.0's Nouveau connection also relied on the ibrowse library (#11153).

## Root Cause

The CouchDB base image version pinned in couchdb/Dockerfile and couchdb-nouveau/Dockerfile was behind 3.5.2; the Nouveau container/service name did not follow the `couchdb-nouveau` image-tag naming convention that CI log collection depends on; and the default Nouveau request timeout was too low for long-running requests.

## Solution

Bumped the CouchDB base image to 3.5.2 in couchdb/Dockerfile and couchdb-nouveau/Dockerfile; set [nouveau] request_timeout to 1h in couchdb/10-docker-default.ini; renamed the Nouveau container to `couchdb-nouveau` to match its image tag and satisfy the CI log-collection naming convention; and updated the replication-failure-log integration test and the shared tests/utils helper to align with the new naming/version.

## Code Patterns

Pin the CouchDB version at the FROM line of couchdb/Dockerfile and couchdb-nouveau/Dockerfile when upgrading; bake CouchDB defaults via couchdb/10-docker-default.ini (e.g. [nouveau] request_timeout); keep container/service names aligned with their image tags (couchdb-nouveau) so convention-based CI log collection picks them up; update tests/utils/index.js when container names change.

## Design Choices

Skipped CouchDB 3.5.1 because of a documented performance regression and jumped straight to 3.5.2, which retains the wanted Nouveau fixes, Nouveau performance improvements, and _purge optimizations without the regression. Raised nouveau.request_timeout to 1h to accommodate long-running Nouveau (search/indexing) requests rather than letting them time out.

## Related Files

- couchdb/Dockerfile
- couchdb-nouveau/Dockerfile
- couchdb/10-docker-default.ini
- tests/integration/api/controllers/replication-failure-log.spec.js
- tests/utils/index.js

## Testing

Updated the existing API integration test tests/integration/api/controllers/replication-failure-log.spec.js and the shared tests/utils/index.js helper to match the new CouchDB version and the renamed couchdb-nouveau container; the container rename additionally restores CI log capture, improving test-run observability. No new test suite was added beyond adapting existing integration coverage to the upgrade.

## Related Issues

- #11080: Upgrade CouchDB to 3.5.x to gain Nouveau fixes, Nouveau performance improvements, and _purge optimizations (3.5.1 skipped due to a performance regression)
- #11153: CouchDB 3.5.0 connects to Nouveau using the ibrowse library
- #6615: Future use of _purge optimizations to clean up historical data from CouchDB

## Domain Rationale

**Fit:** strong

This is a database version bump pinned in Docker images, a Docker-baked CouchDB ini default, and a CI container-naming fix for log collection — squarely build/deploy/upgrade-lifecycle work, which belongs to infrastructure (not configuration, per the CI/Docker pitfall).

---
id: cht-core-9968
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9968
issueUrl: https://github.com/medic/cht-core/issues/9968
title: Rename Docker Helper CouchDB compose file to cht-couchdb.yml so CouchDB image upgrades correctly
lastUpdated: '2026-10-01'
summary: Docker Helper instances failed to upgrade their CouchDB image because the couchdb compose file name didn't match the expected convention. The fix renames the file to `cht-couchdb.yml` so upgrades pick up the new CouchDB image version.
services:
  - api
techStack:
  - docker
  - docker-compose
  - bash
  - couchdb
  - shell
tags:
  - docker-helper
  - couchdb
  - upgrade
  - docker-compose
  - deployment
  - compose-file-naming
related_workflows: []
source_pr: medic/cht-core#9970
source_sha: 5ebc35cdaf714d155935cad506f48cc0501d1041
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/docker-helper-4.x/cht-docker-compose.sh
concepts:
  - docker-compose orchestration
  - container image upgrade
  - CouchDB containerization
  - docker helper local-dev tooling
  - compose file naming convention
related_issues: []
stale: true
---

> **Paths are as of this PR, not as of master.** scripts/docker-helper-4.x/cht-docker-compose.sh
> was deleted on master by PR #10207 (`d605daa23`, 2025-08-28), which replaced the old 3.x helper
> at scripts/docker-helper/cht-docker-compose.sh with this 4.x script. On master the helper lives
> at scripts/docker-helper/cht-docker-compose.sh and still saves the CouchDB compose file as
> `$homeDir/compose/cht-couchdb.yml`.

## Problem

When running CHT via the 4.x Docker Helper, upgrading an existing instance did not upgrade the CouchDB image version: after upgrading a 4.18 instance to 4.19, nginx, api, sentinel, haproxy and healthcheck ran 4.19 images while CouchDB stayed on 4.18. The docker-helper CouchDB compose file was named inconsistently with the canonical build-server convention (`cht-couchdb.yml`), so the upgrade flow did not pick up and bump the CouchDB container.

## Root Cause

Before this PR, scripts/docker-helper-4.x/cht-docker-compose.sh downloaded the staging build's `docker-compose/cht-couchdb.yml` but saved it as `$homeDir/compose/couchdb.yml`. On upgrade, `getUpgradeServicePayload` in api/src/services/setup/utils.js sends the upgrade service the compose files keyed by their staging attachment names with the `docker-compose/` prefix stripped (`cht-core.yml`, `cht-couchdb.yml`), and compose files are matched by name — when nothing matches, the API logs that the CHT docker-compose files you wish to be updated must "match the naming convention". The helper's `couchdb.yml` therefore never matched, and the CouchDB container stayed on the old image.

## Solution

At this PR, `create_compose_files` in scripts/docker-helper-4.x/cht-docker-compose.sh began saving the CouchDB compose file as `$homeDir/compose/cht-couchdb.yml`, and `service_has_image_downloaded` switched to `compose_path="${homeDir}/compose/cht-couchdb.yml"` for the `couchdb` service. This aligns the helper with the compose filenames scripts/build/index.js generates for each build (cht-core.yml, cht-couchdb.yml, cht-couchdb-clustered.yml), so new instances start correctly and the CouchDB image is upgraded along with the rest of the stack.

## Code Patterns

Docker Helper compose filenames under `$homeDir/compose/` in scripts/docker-helper-4.x/cht-docker-compose.sh at this PR: `cht-core.yml` and `cht-couchdb.yml`, the same names as the build's compose attachments (the helper does not use `cht-couchdb-clustered.yml`). Instances created before this PR must be migrated manually by renaming the on-disk compose file, e.g. `mv ~/.medic/cht-docker/<project>-dir/compose/couchdb.yml ~/.medic/cht-docker/<project>-dir/compose/cht-couchdb.yml`.

## Design Choices

Standardize on the build server's published compose filename (`cht-couchdb.yml`) rather than maintaining a divergent helper-local name; this keeps the helper in sync with upstream compose artifacts. The trade-off is that instances created before this PR require a one-time manual rename of the compose file to upgrade.

## Related Files

- scripts/docker-helper-4.x/cht-docker-compose.sh (present at this PR's anchor; moved on master to scripts/docker-helper/cht-docker-compose.sh by PR #10207)

## Testing

No automated tests cover the helper; the diff touches only scripts/docker-helper-4.x/cht-docker-compose.sh. To check the fix by hand: create a new instance and confirm it starts; upgrade it and confirm the CouchDB container's image version moves with the other services (the issue compared them with docker ps); and confirm that a `couchdb.yml` from an instance created before this PR, once renamed to `cht-couchdb.yml`, works.

## Related Issues

- #9968: "CHT running in Docker Helper doesn't upgrade CouchDB" — this draft's issue; after an upgrade from 4.18 to 4.19 in Docker Helper, CouchDB stayed on the 4.18 image while nginx, api, sentinel, haproxy and healthcheck moved to 4.19.

## Domain Rationale

**Fit:** strong

This is purely operational/deployment tooling — a fix to the CHT Docker Helper script's CouchDB compose file naming so the upgrade lifecycle works. Docker/compose and upgrade tooling are canonical infrastructure, not application behavior.

---
id: cht-core-9968
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9968
issueUrl: https://github.com/medic/cht-core/issues/9968
title: Rename Docker Helper CouchDB compose file to cht-couchdb.yml so CouchDB image upgrades correctly
lastUpdated: '2026-06-22'
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
stale: false
---

## Problem

When running CHT via the 4.x Docker Helper, upgrading an existing instance did not upgrade the CouchDB image version. The docker-helper CouchDB compose file was named inconsistently with the canonical build-server convention (`cht-couchdb.yml`), so the upgrade flow did not pick up and bump the CouchDB container.

## Root Cause

The docker-helper script wrote/referenced the CouchDB compose file under a non-canonical name (e.g. `couchdb.yml`) that diverged from the build/upgrade tooling's expected filename `cht-couchdb.yml`, so the CouchDB service definition was not matched during upgrade and the image stayed on the old version.

## Solution

Renamed the CouchDB docker compose file in the Docker Helper to `cht-couchdb.yml` in scripts/docker-helper-4.x/cht-docker-compose.sh, aligning it with the canonical compose filenames (cht-core.yml, cht-couchdb.yml, cht-couchdb-clustered.yml) so new instances start correctly and the CouchDB image is upgraded along with the rest of the stack.

## Code Patterns

Canonical Docker Helper compose filenames in scripts/docker-helper-4.x/cht-docker-compose.sh: `cht-core.yml`, `cht-couchdb.yml`, `cht-couchdb-clustered.yml`. Existing instances created from master must be migrated manually by renaming the on-disk compose file, e.g. `mv ~/.medic/cht-docker/<project>-dir/compose/couchdb.yml ~/.medic/cht-docker/<project>-dir/compose/cht-couchdb.yml`.

## Design Choices

Standardize on the build server's published compose filename (`cht-couchdb.yml`) rather than maintaining a divergent helper-local name; this keeps the helper in sync with upstream compose artifacts. The trade-off is that pre-existing master-created instances require a one-time manual rename of the compose file to upgrade.

## Related Files

- scripts/docker-helper-4.x/cht-docker-compose.sh

## Testing

Manual verification: (1) a new instance created on this branch starts up correctly; (2) a new instance can be upgraded and the CouchDB image version is upgraded too; (3) a CouchDB compose file from a master-created instance, after being renamed to cht-couchdb.yml, works on this branch.

## Related Issues

- #9968: Docker Helper (4.x) CouchDB upgrade bug — compose file naming prevented the CouchDB image from being upgraded

## Domain Rationale

**Fit:** strong

This is purely operational/deployment tooling — a fix to the CHT Docker Helper script's CouchDB compose file naming so the upgrade lifecycle works. Docker/compose and upgrade tooling are canonical infrastructure, not application behavior.

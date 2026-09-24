---
id: cht-core-9882
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9882
issueUrl: https://github.com/medic/cht-core/issues/9882
title: Upgrade CouchDB and CouchDB-Nouveau Docker images to version 3.5.0
lastUpdated: '2026-06-22'
summary: Development had been targeting older CouchDB/Nouveau 3.4.x releases; this PR upgrades both the couchdb and couchdb-nouveau Docker images to the newer 3.5.0 release to stay current with upstream fixes and features.
services:
  - api
  - sentinel
techStack:
  - couchdb
  - nouveau
  - docker
tags:
  - couchdb
  - nouveau
  - docker
  - version-bump
  - dependency-upgrade
  - 3.5.0
related_workflows:
  - nouveau-search
  - data-migration
source_pr: medic/cht-core#9960
source_sha: e5c37866b9fac857f318e11a19c5c7ec1e81dc59
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - couchdb/Dockerfile
  - couchdb-nouveau/Dockerfile
concepts:
  - CouchDB version upgrade
  - Docker image version pinning
  - runtime dependency maintenance
  - Nouveau full-text search engine
  - CouchDB/Nouveau lockstep versioning
related_issues:
  - cht-core-10027
stale: false
---

## Problem

The CouchDB and Nouveau Docker images were pinned to an older 3.4.x line while a newer CouchDB/Nouveau release (3.5.0) was available; the project needed to move off the in-development 3.4.x target onto the current released version to pick up upstream fixes and features.

## Root Cause

The CouchDB and CouchDB-Nouveau base/version references in couchdb/Dockerfile and couchdb-nouveau/Dockerfile were set to an older version and required bumping; this is maintenance need rather than a defect in application code.

## Solution

Updated the version references in both couchdb/Dockerfile and couchdb-nouveau/Dockerfile so the database tier builds/runs CouchDB 3.5.0, keeping the two images in lockstep.

## Code Patterns

CouchDB version is pinned in the Dockerfiles — upgrade by bumping the version in couchdb/Dockerfile and couchdb-nouveau/Dockerfile together, never one without the other, so the core DB and the Nouveau search sidecar stay on the same release.

## Design Choices

CouchDB and Nouveau versions are kept in lockstep (both Dockerfiles bumped in the same PR). The change was validated by a real upgrade test against a large existing dataset rather than only unit tests, since a Dockerfile version bump's risk is in data/upgrade compatibility, not application logic.

## Related Files

- couchdb/Dockerfile
- couchdb-nouveau/Dockerfile

## Testing

No automated tests added (Dockerfile-only change). Manually verified by jkuester upgrading a 9542-freetext-tco instance containing ~500,000 contacts/reports to the 9882 branch; everything worked as expected and monitoring data for the upgrade run was captured.

## Related Issues

- #9882: Upgrade Couch/Nouveau to the latest released version (originally targeting 3.4.3, landed on 3.5.0)
- #9691: CouchDB upgrade lifecycle code (prerequisite for the upgrade)
- #9542: freetext_tco branch stability (prerequisite baseline that was upgraded from)

## Domain Rationale

**Fit:** strong

The PR only bumps the CouchDB and CouchDB-Nouveau Docker image versions to 3.5.0 — pure runtime-dependency maintenance / Docker image change, which is exactly the operational lifecycle (Docker/upgrade tooling) that defines the infrastructure domain. It does not touch application code or storage-engine internals like index design docs.

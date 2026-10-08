---
id: cht-core-9882
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9882
issueUrl: https://github.com/medic/cht-core/issues/9882
title: Upgrade CouchDB and CouchDB-Nouveau Docker images to version 3.5.0
lastUpdated: '2026-10-08'
summary: 'On the Nouveau epic branch, development had been targeting CouchDB/Nouveau 3.4.2; this PR upgrades both the couchdb and couchdb-nouveau Docker base images to the newer 3.5.0 release. The CouchDB-only bump on master was a separate same-day PR (#10014), and both images are at 3.5.2 on master since PR #11162.'
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
  - cht-core-9691
  - cht-core-9542
stale: true
---

> **Epic child.** PR #9960 was squash-merged into the feature branch `9542_freetext_tco`
> (`e5c37866b`, 2025-06-11), not into master. That branch reached master as PR #10201
> (`f1bdfc07c`, 2025-08-22). Its own PR number is stamped nowhere on master, and this
> draft's `source_sha` is not on master. To resolve it, run
> `git fetch origin +refs/pull/10201/head:refs/verify/pr10201` — the epic PR's head ref.
>
> **Superseded after landing (`stale-as-written`):** master's couchdb/Dockerfile bump did not come
> from this PR — master already had `FROM couchdb:3.5.0 as base_couchdb_build` from PR #10014
> (`3cb82585e`), merged the same day, and `f1bdfc07c` leaves that file untouched. Only the
> couchdb-nouveau/Dockerfile half reached master through the epic: PR #10201 added that file with
> `FROM couchdb:3.5.0-nouveau`. On master, PR #11162 (`9cbe335ab`) later moved both images to 3.5.2
> (`couchdb:3.5.2` and `couchdb:3.5.2-nouveau`). Versions below are as of this PR.

## Problem

Before this PR, the CouchDB and Nouveau Docker images on the `9542_freetext_tco` branch were pinned to 3.4.2 while newer CouchDB/Nouveau releases were available. #9882 was opened when 3.4.3 came out, later retargeted to 3.5.0, and asked that the upgrade also fully validate upgrading an instance with existing Nouveau indexes.

## Root Cause

At this PR's parent, the CouchDB and CouchDB-Nouveau base/version references in couchdb/Dockerfile and couchdb-nouveau/Dockerfile were set to an older version and required bumping; this is maintenance need rather than a defect in application code.

## Solution

Updated the version references in both couchdb/Dockerfile (`FROM couchdb:3.4.2 AS base_couchdb_build` → `FROM couchdb:3.5.0 AS base_couchdb_build`) and couchdb-nouveau/Dockerfile (`FROM couchdb:3.4.2-nouveau` → `FROM couchdb:3.5.0-nouveau`) so the database tier builds/runs CouchDB 3.5.0, keeping the two images in lockstep.

## Code Patterns

CouchDB version is pinned in the Dockerfiles — upgrade by bumping the version in couchdb/Dockerfile and couchdb-nouveau/Dockerfile together, so the CouchDB image and the Nouveau server image (the `-nouveau` tag of the same CouchDB version) stay on the same release.

## Design Choices

CouchDB and Nouveau versions are kept in lockstep (both Dockerfiles bumped in the same PR). #9882 deliberately waited for the epic branch to be stable and for #9691's lifecycle code, so that this upgrade would also exercise upgrading an instance that already has Nouveau indexes — a base-image bump's risk is in data/upgrade compatibility, not application logic.

## Related Files

- couchdb/Dockerfile
- couchdb-nouveau/Dockerfile

## Testing

No test files changed; the diff is the first `FROM` line of each of the two Dockerfiles. A reviewer also tested it locally by upgrading an instance of the epic branch holding 500,000 contacts/reports to this PR's branch, and everything worked as expected.

## Related Issues

- #9882: "Upgrade to latest version of Couch/Nouveau to 3.5.0" — this PR's issue (opened for 3.4.3, retargeted to 3.5.0)
- #10027: "Upgrade CouchDB to version 3.5.0" — separate issue for the CouchDB-only bump on master (PR #10014, merged the same day); #9882 had planned to upgrade both images with the Nouveau epic, but CouchDB could be upgraded without waiting for it, and since PR #10014 targeted master it needed its own stand-alone issue, unlike PR #9960, which merged into the epic branch
- #9691: "Plug Nouveau APIs with API lifecycle" — #9882 waited for this issue's lifecycle code before upgrading
- #9542: "Reduce disk space with CouchDB Nouveau (TCO v1)" — the epic whose `9542_freetext_tco` branch this PR targeted; #9882 waited for that branch to be stable

## Domain Rationale

**Fit:** strong

The PR changes only the base-image `FROM` lines of couchdb/Dockerfile and couchdb-nouveau/Dockerfile, moving both database base images to 3.5.0 — runtime-dependency maintenance of the Docker images CHT ships. It does not touch application code or storage-engine internals like index design docs.

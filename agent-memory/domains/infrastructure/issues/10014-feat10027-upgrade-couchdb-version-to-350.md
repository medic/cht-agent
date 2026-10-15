---
id: cht-core-10027
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 10027
issueUrl: https://github.com/medic/cht-core/issues/10027
title: Upgrade the CouchDB Docker base image on master from 3.4.2 to 3.5.0 (CouchDB only; Nouveau was not yet on master)
lastUpdated: '2026-10-01'
summary: 'Development was still targeting CouchDB/Nouveau 3.4.2 after 3.5.0 was released; the PR bumps the pinned CouchDB version in couchdb/Dockerfile on master to 3.5.0 to keep the runtime dependency current. Master had no Nouveau image yet, so the matching Nouveau bump was made separately on the epic branch by PR #9960.'
services:
  - api
  - sentinel
techStack:
  - couchdb
  - docker
tags:
  - couchdb
  - version-upgrade
  - dependency-upgrade
  - dockerfile
  - nouveau
related_workflows:
  - nouveau-search
source_pr: medic/cht-core#10014
source_sha: 3cb82585e0ba5b305640319f11219b3b517cd01a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - couchdb/Dockerfile
concepts:
  - containerization
  - dependency-management
  - database-version-pinning
  - runtime-dependency-upgrade
related_issues:
  - cht-core-9882
stale: true
---

> **Superseded after landing (`stale-as-written`):** on master, couchdb/Dockerfile has since moved
> to `FROM couchdb:3.5.2 AS base_couchdb_build` (PR #11162, `9cbe335ab`), and since PR #10201
> (`f1bdfc07c`) a second image, couchdb-nouveau/Dockerfile, pins the matching `-nouveau` tag, so a
> CouchDB bump on master is no longer a one-file change. The version and single-Dockerfile layout
> below are as of this PR.

## Problem

CHT development was pinned to CouchDB/Nouveau 3.4.2, but upstream had released 3.5.0. Before this PR, master's couchdb/Dockerfile pinned `FROM couchdb:3.4.2 as base_couchdb_build`; master had no Nouveau component yet — that work was still on the `9542_freetext_tco` epic branch.

## Root Cause

At this PR's parent, couchdb/Dockerfile hard-pinned the CouchDB base image tag to the previously-targeted 3.4.2 release.

## Solution

Updated the pinned CouchDB version in couchdb/Dockerfile to 3.5.0 (`FROM couchdb:3.5.0 as base_couchdb_build`) — the PR's only change. There was no Nouveau image on master to bump; on the epic branch, PR #9960 moved couchdb-nouveau/Dockerfile to `couchdb:3.5.0-nouveau`.

## Code Patterns

Single-point version pinning at this PR: bump the CouchDB base image tag in couchdb/Dockerfile, which builds the `cht-couchdb` image that scripts/build/cht-couchdb-single-node.yml.template and scripts/build/cht-couchdb-cluster.yml.template reference as `{{{ repo }}}/cht-couchdb:{{ tag }}`, so single-node and clustered compose deployments inherit the new version.

## Design Choices

Track the latest released CouchDB line rather than lagging on 3.4.2. The bump went to master under its own issue, #10027 (milestone 4.21.0; the commit was released in 4.21.0), separate from #9882, which upgrades both CouchDB and Nouveau on the epic branch (PR #9960): CouchDB itself could be upgraded without waiting for the Nouveau work.

## Related Files

- couchdb/Dockerfile

## Testing

No test files changed; the diff is a one-line change to the first `FROM` line of couchdb/Dockerfile.

## Related Issues

- #10027: "Upgrade CouchDB to version 3.5.0" — this PR's issue, opened for this master PR; it covers the CouchDB-only upgrade
- #9882: "Upgrade to latest version of Couch/Nouveau to 3.5.0" — the separate epic-branch issue that upgrades both CouchDB and Nouveau (PR #9960, merged the same day); #10027 was split from it so the CouchDB bump could ship on master first

## Domain Rationale

**Fit:** strong

This is a runtime-dependency maintenance change — bumping the pinned CouchDB base-image version in couchdb/Dockerfile — which is operational lifecycle work (how the system is built/shipped/run), not application behavior or data-layer code.

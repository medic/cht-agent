---
id: cht-core-10027
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 10027
issueUrl: https://github.com/medic/cht-core/issues/10027
title: Upgrade CouchDB (and bundled Nouveau) Docker base image from 3.4.2 to 3.5.0
lastUpdated: '2026-06-22'
summary: Development was still targeting CouchDB/Nouveau 3.4.2 after 3.5.0 was released; the PR bumps the pinned CouchDB version in the Dockerfile to 3.5.0 to keep the runtime dependency current.
services:
  - api
  - sentinel
techStack:
  - couchdb
  - docker
  - nouveau
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
related_issues: []
stale: false
---

## Problem

CHT development was pinned to CouchDB/Nouveau 3.4.2, but upstream had released 3.5.0. Staying on the older version meant missing the latest CouchDB and bundled Nouveau search improvements and fixes.

## Root Cause

The couchdb/Dockerfile hard-pinned the CouchDB base image tag to the previously-targeted 3.4.2 release.

## Solution

Updated the pinned CouchDB version in couchdb/Dockerfile to 3.5.0, which also advances the bundled Nouveau search engine to 3.5.0.

## Code Patterns

Single-point version pinning: bump the CouchDB base image tag in couchdb/Dockerfile so all downstream single-node and clustered compose deployments inherit the new version.

## Design Choices

Track the latest released CouchDB/Nouveau line rather than lagging on 3.4.2. Reviewer (jkuester) suggested promoting the related issue #9882 to a standalone issue (removing the TCO parent) and assigning it to the 4.21.0 milestone.

## Related Files

- couchdb/Dockerfile

## Testing

No automated tests added (pure version bump). Build CI produced compose artifacts and the PR provided Core, CouchDB Single, and CouchDB Cluster compose URLs for manual bring-up verification.

## Related Issues

- #10027: request to upgrade Couch/Nouveau to the newly released 3.5.0 (dev was targeting 3.4.2)
- #9882: related upgrade-tracking issue the reviewer proposed making standalone and adding to the 4.21.0 milestone

## Domain Rationale

**Fit:** strong

This is a runtime-dependency maintenance change — bumping the pinned CouchDB base-image version in couchdb/Dockerfile — which is operational lifecycle work (how the system is built/shipped/run), not application behavior or data-layer code.

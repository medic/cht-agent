---
id: cht-core-10305
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10305
issueUrl: https://github.com/medic/cht-core/issues/10305
title: Disable CouchDB request rate limiter in the Docker default config (10-docker-default.ini)
lastUpdated: '2026-06-22'
summary: CouchDB's request rate limiter was throttling CHT's database traffic; this PR disables the limiter in the CouchDB Docker default config (`couchdb/10-docker-default.ini`).
services:
  - api
  - sentinel
  - webapp
techStack:
  - couchdb
  - docker
  - ini
tags:
  - couchdb
  - rate-limiter
  - docker
  - performance
  - replication
related_workflows: []
source_pr: medic/cht-core#10512
source_sha: 5f59e9f836009c2e6e58b67a59ac4c967935ae9b
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - couchdb/10-docker-default.ini
concepts:
  - rate limiting
  - request throttling
  - CouchDB server configuration
  - Docker default configuration
related_issues: []
stale: false
---

## Problem

CouchDB's built-in request rate limiter was throttling CHT's CouchDB traffic, causing legitimate high-volume requests to be rejected or slowed when the limiter engaged. User-visible symptoms are tracked in a private issue (medic-projects#8243), but the practical effect is degraded/failing CouchDB requests under load.

## Root Cause

CouchDB's rate limiter was active in CHT deployments because the bundled CouchDB Docker default config (`couchdb/10-docker-default.ini`) did not disable it, so CHT's trusted internal request volume hit the database server's throttle.

## Solution

Edited `couchdb/10-docker-default.ini` to disable CouchDB's rate limiter so CHT traffic is no longer throttled by the database server. Single-file, config-only change applied at the Docker-image default layer.

## Code Patterns

CHT tunes its bundled CouchDB by editing the `.ini` files under `couchdb/` (e.g. `10-docker-default.ini`) that are baked into the CouchDB Docker image; override an upstream CouchDB default (here, the rate limiter) by setting the corresponding key in that default config rather than via per-deployment overrides. Watch INI comment syntax (`;`) — a review note flagged a stray `2`.

## Design Choices

Applied at the shared Docker-default config layer so every CHT CouchDB deployment inherits the setting, rather than documenting a per-instance override. Disabling the limiter outright (vs. raising its threshold) reflects that CHT's CouchDB serves trusted internal/CHT traffic that should not be self-throttled.

## Related Files

- couchdb/10-docker-default.ini

## Testing

Config-only change with no automated tests added. Manually verified by checking out the branch and building dev Docker images (`npm ci; npm run build-dev; npm run local-images`), running on Docker 28 (Docker 27 hit an unrelated cht-upgrade-service issue #50).

## Related Issues

- #10305: Update CouchDB config to disable the rate limiter (full details in private medic-projects#8243)

## Domain Rationale

**Fit:** strong

The change is a CouchDB Docker default config file (`couchdb/10-docker-default.ini`) that tunes the database server's operational request-throttling — i.e., how the deployed system runs — which squarely fits the infrastructure (Docker/deploy lifecycle) domain. It is a server deployment-config tweak, not a CouchDB data-layer/storage-engine internal like index or ID-generation design (which would be data-sync) and not CHT app configuration like translations/app_settings (which would be configuration); the data-sync adjacency exists only because the limiter affects replication throughput.

---
id: cht-core-8644
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 8644
issueUrl: https://github.com/medic/cht-core/issues/8644
title: Add concurrency support and build-time frozen dependencies to the haproxy-healthcheck service
lastUpdated: '2026-06-23'
summary: The haproxy-healthcheck service could hang when a connection wasn't closed properly and installed unpinned Python dependencies at startup; this PR reworks it to handle concurrent connections and bundles frozen, version-pinned dependencies into the container image at build time.
services:
  - api
  - sentinel
techStack:
  - python
  - docker
  - docker-compose
  - haproxy
  - couchdb
  - pytest
tags:
  - haproxy
  - healthcheck
  - concurrency
  - dependency-freezing
  - docker
  - python
  - load-balancer
  - reproducible-builds
related_workflows:
  - observability
source_pr: medic/cht-core#8813
source_sha: 3c3accebdfba8db7ad2c5261eeb75da79e7ad56c
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - haproxy-healthcheck/check.py
  - haproxy-healthcheck/logger.py
  - haproxy-healthcheck/Dockerfile
  - haproxy-healthcheck/compose.yml
  - haproxy-healthcheck/pyproject.toml
  - haproxy-healthcheck/requirements/base-freeze.txt
  - haproxy-healthcheck/check-entrypoint.sh
concepts:
  - load balancer health check
  - concurrent connection handling
  - dependency pinning/freezing
  - build-time vs runtime dependency installation
  - reproducible container builds
  - deployment resilience
related_issues: []
stale: false
---

## Problem

The haproxy-healthcheck service handled only a single connection at a time and could hang indefinitely if a connection wasn't closed properly. It also installed its Python dependencies (latest versions) at container startup, so a PyPI outage or an incompatible upstream dependency release could prevent an already-deployed service from starting.

## Root Cause

The service was implemented for single-connection handling with no concurrency, so an unclosed connection blocked it. Dependencies were not baked into the image — they were resolved and installed unpinned at startup, making service availability dependent on PyPI reachability and whatever 'latest' versions happened to be published.

## Solution

Reworked the Python service (check.py) to support more than one concurrent connection so it no longer hangs on an improperly closed connection, and moved dependency installation into the Docker image build using frozen/pinned requirements (requirements/base-freeze.txt and test-freeze.txt) instead of installing latest at runtime. Added pyproject.toml, a Makefile, a requirements/update.sh regeneration script, mock config, and basic unit tests.

## Code Patterns

Freeze Python dependencies into version-pinned requirements files (requirements/base-freeze.txt, requirements/test-freeze.txt) regenerated via requirements/update.sh, and install them at image-build time in the Dockerfile rather than at container startup, so deployments are independent of PyPI availability and upstream 'latest' churn. Concurrent connection handling in the healthcheck listener (check.py) so a single stuck/unclosed connection cannot block the service.

## Design Choices

Kept the service in Python to reuse existing code rather than rewriting in another language. Pinned and bundled dependencies at build time for resilience against PyPI outages and incompatible releases. Test coverage was kept deliberately basic given the service's limited expected lifetime. The log level defaults to warning instead of info to reduce log noise.

## Related Files

- haproxy-healthcheck/check.py
- haproxy-healthcheck/logger.py
- haproxy-healthcheck/Dockerfile
- haproxy-healthcheck/Makefile
- haproxy-healthcheck/compose.yml
- haproxy-healthcheck/check-entrypoint.sh
- haproxy-healthcheck/pyproject.toml
- haproxy-healthcheck/requirements/base-freeze.txt
- haproxy-healthcheck/requirements/test-freeze.txt
- haproxy-healthcheck/requirements/update.sh
- haproxy-healthcheck/test/test_check.py
- haproxy-healthcheck/mock-config/initializerJson.json
- haproxy/tests/compose.yml
- package.json

## Testing

Added basic Python unit tests (haproxy-healthcheck/test/test_check.py, test/__init__.py) with test dependencies frozen in requirements/test-freeze.txt and a mock config (mock-config/initializerJson.json) for the test harness.

## Related Issues

- #8644: Support concurrency for haproxy-healthcheck (tracking issue)
- #8733: Original PR, superseded by #8813 to update the branch name

## Domain Rationale

**Fit:** strong

The haproxy-healthcheck is an operational support service for the HAProxy load balancer that fronts CouchDB; the PR changes container packaging, dependency freezing, and connection handling — squarely operational/deploy lifecycle work (Docker/HAProxy), not application behavior.

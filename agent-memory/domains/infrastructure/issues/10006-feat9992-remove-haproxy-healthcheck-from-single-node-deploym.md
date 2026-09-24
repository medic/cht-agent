---
id: cht-core-9992
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9992
issueUrl: https://github.com/medic/cht-core/issues/9992
title: Remove haproxy-healthcheck service from single-node deployments, relying on CouchDB's built-in _up endpoint instead
lastUpdated: '2026-07-16'
summary: The haproxy-healthcheck container, only needed to monitor clustered CouchDB nodes, was being deployed even in single-node setups where it serves no purpose. The PR moves the service into the cluster-only compose template and reconfigures HAProxy to use CouchDB's native _up endpoint for single-node health checks.
services:
  - api
techStack:
  - haproxy
  - docker-compose
  - couchdb
  - bash
  - javascript
tags:
  - haproxy
  - healthcheck
  - single-node
  - couchdb
  - docker-compose
  - deployment
  - _up-endpoint
related_workflows:
  - observability
source_pr: medic/cht-core#10006
source_prs:
  - "medic/cht-core#10006"
  - "medic/cht-core#10267"
source_sha: 18cd5403cd02baebd8dfcddfe748e0febc3958e7
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - haproxy/entrypoint.sh
  - scripts/build/cht-core.yml.template
  - scripts/build/cht-couchdb-cluster.yml.template
  - haproxy/tests/integration.spec.js
  - haproxy/tests/compose-single.yml
  - haproxy/tests/compose-cluster.yml
concepts:
  - load balancer health checking
  - deployment topology (single-node vs clustered CouchDB)
  - Docker Compose template composition
  - CouchDB built-in _up endpoint
  - conditional service inclusion by deployment mode
related_issues: []
stale: false
---

## Problem

The haproxy-healthcheck service — a separate container that periodically polls CouchDB nodes to confirm cluster availability — was defined in the shared docker-compose template and therefore deployed in every environment, including single-node setups. Single-node deployments have no cluster to monitor, so the container consumed resources and added operational surface area without benefit.

## Root Cause

The haproxy-healthcheck service was declared in the common scripts/build/cht-core.yml.template used by all deployments, and HAProxy's entrypoint was wired to depend on that external healthcheck regardless of whether CouchDB was clustered or single-node.

## Solution

Relocated the haproxy-healthcheck service definition from the shared cht-core.yml.template into the cluster-specific cht-couchdb-cluster.yml.template so it only deploys for clustered CouchDB. Updated haproxy/entrypoint.sh so single-node deployments perform health checks against CouchDB's built-in _up endpoint instead of the external healthcheck service, and added HAProxy integration tests covering both single-node and cluster topologies.

A follow-up fixed a base64 line-wrapping bug in this health config: `base64` inserts newlines every 76 characters by default, which broke the HAProxy health config when the CouchDB username + password were long; adding the no-wrap flag allows long credentials (PR #10267).

## Code Patterns

Split a service across deployment modes by declaring cluster-only services (haproxy-healthcheck) in scripts/build/cht-couchdb-cluster.yml.template rather than the shared scripts/build/cht-core.yml.template. For single-node health, point HAProxy at CouchDB's native _up endpoint in haproxy/entrypoint.sh. Validate each topology with a dedicated compose file (haproxy/tests/compose-single.yml, haproxy/tests/compose-cluster.yml) plus a mock CouchDB config, driven by haproxy/tests/integration.spec.js.

## Design Choices

Rather than keeping the healthcheck container in all deployments and conditionally disabling it, the service was moved entirely into the cluster template so single-node deployments never instantiate it. CouchDB's built-in _up endpoint is sufficient to confirm single-node health, removing the need for a redundant external polling container.

## Related Files

- haproxy/entrypoint.sh
- haproxy/tests/Makefile
- haproxy/tests/compose-cluster.yml
- haproxy/tests/compose-single.yml
- haproxy/tests/integration.spec.js
- haproxy/tests/mock-config/conf.d/mock-couchdb.conf
- haproxy/tests/package.json
- scripts/build/cht-core.yml.template
- scripts/build/cht-couchdb-cluster.yml.template
- tests/integration/api/server.spec.js

## Testing

Added HAProxy integration tests (haproxy/tests/integration.spec.js) with separate compose configurations for single-node (compose-single.yml) and clustered (compose-cluster.yml) CouchDB, backed by a mock CouchDB config and a Makefile/package.json test harness. The API integration test (tests/integration/api/server.spec.js) was updated to reflect the revised health-check behavior.

## Related Issues

- #9992: Remove haproxy-healthcheck from single-node deployments since it is only required for clustered CouchDB

## Domain Rationale

**Fit:** strong

This is purely deployment/operational lifecycle work — HAProxy configuration and Docker Compose deployment templates differentiating single-node from clustered CouchDB. HAProxy and Docker/compose templating are canonical infrastructure, with no change to application behavior.

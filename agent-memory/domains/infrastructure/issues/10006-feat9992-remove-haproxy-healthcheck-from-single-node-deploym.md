---
id: cht-core-9992
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9992
issueUrl: https://github.com/medic/cht-core/issues/9992
title: Remove haproxy-healthcheck service from single-node deployments, relying on CouchDB's built-in _up endpoint instead
lastUpdated: '2026-10-05'
summary: "The haproxy-healthcheck container, only needed to monitor clustered CouchDB nodes, was being deployed even in single-node setups where it serves no purpose. PR #10006 moves the service into the cluster-only compose template and reconfigures HAProxy to use CouchDB's native _up endpoint for single-node health checks; follow-up PR #10267 adds `-w 0` to the `base64` call that encodes that check's credentials so long credentials no longer wrap."
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

Before this PR, the haproxy-healthcheck service — a separate container that periodically polls CouchDB nodes to confirm cluster availability — was defined in the shared docker-compose template and therefore deployed in every Docker Compose environment, including single-node setups. Single-node deployments have no cluster to monitor, so the container consumed resources and added operational surface area without benefit.

## Root Cause

Before this PR, the healthcheck service (compose key `healthcheck`, image `{{{ repo }}}/cht-haproxy-healthcheck:{{ tag }}`) was declared in the common scripts/build/cht-core.yml.template, which single-node and clustered Docker Compose deployments share, and haproxy/entrypoint.sh gave every generated `server` line `check agent-check agent-inter 5s agent-addr $HEALTHCHECK_ADDR agent-port 5555`, so HAProxy consulted that external healthcheck agent for every CouchDB server regardless of whether CouchDB was clustered or single-node.

## Solution

Relocated the `healthcheck` service definition from the shared scripts/build/cht-core.yml.template into the cluster-specific scripts/build/cht-couchdb-cluster.yml.template (rendered as `cht-couchdb-clustered.yml` by scripts/build/index.js) so it only deploys for clustered CouchDB. haproxy/entrypoint.sh now reads `COUCHDB_SERVERS` into an array; when it holds exactly one server (`if [[ ${#SERVERS[@]} -eq 1 ]]`), it writes `option httpchk`, `http-check send meth GET uri /_up hdr Authorization 'Basic ${basic_auth}'` and `http-check expect status 200` to the backend and gives that server a plain `check inter 5s`, so single-node deployments health-check CouchDB's built-in _up endpoint instead of the external healthcheck service. With more than one server it keeps the per-server `agent-check` (now against `${HEALTHCHECK_ADDR:-localhost}`) and writes the password files under `/srv/storage/haproxy/passwd`, which it previously wrote unconditionally. The HAProxy test harness was reorganized to run the same spec against a single-node and a clustered mock (see Testing).

Follow-up PR #10267 (`9a4ff5c09`, "fix(#9992): fix line wrapping in haproxy config") changed one line of haproxy/entrypoint.sh, inside the single-server branch above: `basic_auth=$(echo -n "$COUCHDB_USER:$COUCHDB_PASSWORD" | base64)`, as it stood at this PR, gained `-w 0`. `base64` inserts a newline every 76 output characters by default, so a `$COUCHDB_USER:$COUCHDB_PASSWORD` string longer than 57 bytes put a line break into the `http-check send` line and broke the HAProxy health config; `-w 0` disables the wrapping and allows long credentials.

## Code Patterns

Split a service across deployment modes by declaring cluster-only services (the `healthcheck` service) in scripts/build/cht-couchdb-cluster.yml.template rather than the shared scripts/build/cht-core.yml.template. For single-node health, point HAProxy at CouchDB's native _up endpoint in haproxy/entrypoint.sh, and encode the Basic-auth credentials with `base64 -w 0` so the header stays on one line. Validate each topology with a dedicated compose file (haproxy/tests/compose-single.yml, haproxy/tests/compose-cluster.yml) over the nginx mock in haproxy/tests/mock-config/conf.d/mock-couchdb.conf, with haproxy/tests/Makefile running haproxy/tests/integration.spec.js against each.

## Design Choices

Rather than keeping the healthcheck container in all deployments and conditionally disabling it, the service was moved entirely into the cluster template so single-node Docker Compose deployments never instantiate it. The PR left the in-repo Helm chart unchanged: scripts/build/helm/templates/healthcheck/deployment.yaml and scripts/build/helm/templates/healthcheck/service.yaml have no topology guard, so at this PR and on master the chart still deploys the healthcheck pod when CouchDB is single-node, although HAProxy there gets one server in `COUCHDB_SERVERS`, checks `_up` and never consults the pod. CouchDB's built-in _up endpoint is sufficient to confirm single-node health, removing the need for a redundant external polling container. Single-node mode is inferred from the number of entries in `COUCHDB_SERVERS`, so it needs no extra environment variable.

## Related Files

- haproxy/entrypoint.sh
- haproxy/tests/Makefile
- haproxy/tests/compose-cluster.yml (renamed from haproxy/tests/compose.yml)
- haproxy/tests/compose-single.yml (added)
- haproxy/tests/integration.spec.js (renamed from haproxy/tests/with-mock.spec.js)
- haproxy/tests/mock-config/conf.d/mock-couchdb.conf
- haproxy/tests/package.json
- scripts/build/cht-core.yml.template
- scripts/build/cht-couchdb-cluster.yml.template
- tests/integration/api/server.spec.js

## Testing

PR #10006 renamed the existing haproxy/tests/with-mock.spec.js to haproxy/tests/integration.spec.js (raising `waitForService`'s `maxAttempts` from 10 to 30) and haproxy/tests/compose.yml to haproxy/tests/compose-cluster.yml, and added haproxy/tests/compose-single.yml, which runs HAProxy against a single nginx mock (`COUCHDB_SERVERS: mock-couchdb`). haproxy/tests/Makefile replaced its `test_with_docker_compose` target with `test_with_couch_cluster` and `test_with_couch_single`, each running `npm run test:integration` against its compose file; the `test:integration` script in haproxy/tests/package.json now points at haproxy/tests/integration.spec.js, and haproxy/tests/mock-config/conf.d/mock-couchdb.conf gained a `location = /_up` block that returns 200. In tests/integration/api/server.spec.js, the existing `should work after restarting CouchDb @docker` case gained an `await utils.delayPromise(1000);` after `await utils.listenForApi();`. PR #10267 changed no tests.

## Related Issues

- #9992: "Remove haproxy-healthcheck service from single-node CouchDb deployments" — the issue both PRs reference; PR #10006 closes it
- PR #10267: "fix(#9992): fix line wrapping in haproxy config" — the follow-up folded into this memory; it only changes how haproxy/entrypoint.sh base64-encodes the single-node check's credentials

## Domain Rationale

**Fit:** strong

This is purely deployment/operational lifecycle work — HAProxy configuration and Docker Compose deployment templates differentiating single-node from clustered CouchDB. HAProxy and Docker/compose templating are canonical infrastructure, with no change to application behavior.

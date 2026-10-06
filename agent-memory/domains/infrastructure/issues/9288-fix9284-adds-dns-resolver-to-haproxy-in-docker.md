---
id: cht-core-9284
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9284
issueUrl: https://github.com/medic/cht-core/issues/9284
title: Add DNS resolver to HAProxy in Docker so backend hostnames re-resolve after container restart
lastUpdated: '2026-10-05'
summary: HAProxy resolved its CouchDB backend hostnames only once at startup and cached the IP, so when a CouchDB container restarted in Docker with a new IP, routing broke. The fix adds a `resolvers docker_resolver` section pointing at Docker's embedded DNS and attaches it to the backend server lines only when `DOCKER_DNS_RESOLVER` is set, which the Docker Compose template does, so HAProxy re-resolves backend addresses at runtime.
services:
  - api
techStack:
  - haproxy
  - docker
  - couchdb
  - shell
  - javascript
tags:
  - haproxy
  - dns
  - docker
  - dns-resolution
  - container-restart
  - load-balancer
  - service-discovery
related_workflows: []
source_pr: medic/cht-core#9288
source_sha: 4e73a79c71c5e37d892e975052d4bb2a8961e7e8
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - haproxy/default_frontend.cfg
  - haproxy/entrypoint.sh
  - scripts/build/cht-core.yml.template
concepts:
  - DNS service discovery
  - load balancing
  - Docker container networking
  - dynamic backend resolution
related_issues:
  - cht-core-8205
  - cht-core-9286
stale: false
---

## Problem

When a CouchDB container restarted under Docker and was reassigned a new IP address, requests routed through HAProxy failed because HAProxy kept directing traffic to the stale, previously-cached IP. Issue #9284 reproduced it on a single-node 4.9.0 Docker install by stopping and starting the CouchDB container: the instance never came back, HAProxy logged NOSRV 503s and api logged `No server is available to handle this request`, while CouchDB kept logging successful `_membership` calls, presumably from the healthcheck. The issue's author believed the new IP was the cause but had not definitively proven it.

## Root Cause

HAProxy resolves server hostnames at config-parse/startup time and caches the resolved IPs. Before this PR, haproxy/default_frontend.cfg had no `resolvers` section and the `server` lines written by haproxy/entrypoint.sh carried no resolver option, so HAProxy never re-resolved DNS and, after Docker reassigned CouchDB's IP on restart, continued using the old address.

## Solution

Added a `resolvers docker_resolver` section with `nameserver dns 127.0.0.11:53` (Docker's embedded DNS) to haproxy/default_frontend.cfg; it sets no timeout or hold values of its own. haproxy/entrypoint.sh appends ` resolvers docker_resolver resolve-prefer ipv4` to each generated `server` line only when `DOCKER_DNS_RESOLVER` is non-empty (`if [[ -n "${DOCKER_DNS_RESOLVER:-}" ]]; then`), and scripts/build/cht-core.yml.template sets `DOCKER_DNS_RESOLVER=true` on the haproxy service, so Docker Compose deployments re-resolve the CouchDB hostnames at runtime. The existing tests/integration/api/server.spec.js gained a CouchDB-restart case (see Testing).

## Code Patterns

HAProxy runtime DNS resolution pattern: define a `resolvers` section with a `nameserver` pointing to Docker's embedded DNS (127.0.0.11:53) in haproxy/default_frontend.cfg, then attach `resolvers docker_resolver resolve-prefer ipv4` to backend `server` lines. haproxy/entrypoint.sh attaches it only when `DOCKER_DNS_RESOLVER` is set (on master that branch lives in its `setResolver()` helper, added by PR #10006), so `server` lines reference the Docker-only nameserver only in deployments that set the variable.

## Design Choices

Letting HAProxy re-resolve DNS at runtime via Docker's embedded DNS recovers routing automatically after a CouchDB container restart. The resolver is opted into per deployment through the `DOCKER_DNS_RESOLVER` environment variable rather than attached unconditionally in the image, because HAProxy also runs under Kubernetes, where the issue discussion found that adding the Docker DNS resolver failed the deployment; in this repository only the Docker Compose template sets it. It is the same Docker DNS server that nginx already used for #8205 (`resolver 127.0.0.11 valid=10s;` in nginx/templates/server.conf.template).

## Related Files

- haproxy/default_frontend.cfg
- haproxy/entrypoint.sh
- scripts/build/cht-core.yml.template
- tests/integration/api/server.spec.js
- tests/utils/index.js

## Testing

The existing tests/integration/api/server.spec.js gained a `should work after restarting CouchDb @docker` case that calls `stopCouchDb` / `startCouchDb`, two helpers the existing tests/utils/index.js gained and exports (they stop and start `couchdb-1.local`, `couchdb-2.local` and `couchdb-3.local`) and then waits with `utils.listenForApi()`, which retries until a request to `/api/info` succeeds. The case does not inspect IPs, and the issue reports that a test restarting all clustered CouchDB services in Docker passed even before the fix, which its author attributes to at least one CouchDB server coming back on an IP HAProxy was still trying.

## Related Issues

- #9284: "CouchDb restart causes all services to go down" — the issue this PR fixes
- #8205: "Nginx can't connect to API after container restarts because of dynamic IP allocation" — the same stale-DNS problem in nginx, fixed with the same Docker DNS server
- #9286: "Starting an upgrade that involves view indexing can cause CouchDB to crash" — named in this issue's thread as the flaky-CouchDB situation on a Docker production instance that the restart problem was believed to be affecting

## Domain Rationale

**Fit:** strong

The PR changes the HAProxy config, the HAProxy container entrypoint and the Docker Compose template — how the proxy in front of CouchDB is deployed and networked — plus an integration test; no application code changes.

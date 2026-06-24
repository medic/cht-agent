---
id: cht-core-9288
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9288
issueUrl: https://github.com/medic/cht-core/issues/9288
title: Add DNS resolver to HAProxy in Docker so backend hostnames re-resolve after container restart
lastUpdated: '2026-06-23'
summary: HAProxy resolved backend hostnames only once at startup and cached the IP, so when a backend container restarted in Docker with a new IP, routing broke. The fix configures a DNS resolver in HAProxy so it dynamically re-resolves backend addresses at runtime.
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
related_issues: []
stale: false
---

## Problem

When a backend container restarted under Docker and was reassigned a new IP address, requests routed through HAProxy failed because HAProxy kept directing traffic to the stale, previously-cached IP. The 'test-restart' build/test scenario confirms the failure surfaced on container restart.

## Root Cause

HAProxy resolves server hostnames at config-parse/startup time and caches the resolved IPs. Without a configured `resolvers` section and per-server resolver directives, it never re-resolves DNS, so after Docker reassigned a backend's IP on restart, HAProxy continued using the old address.

## Solution

Added a DNS resolver configuration to HAProxy — a `resolvers` section pointing at Docker's embedded DNS server (127.0.0.11) with resolve timeouts — and wired backend `server` directives to use it so HAProxy periodically re-resolves backend hostnames. Updated haproxy/entrypoint.sh and the cht-core.yml.template compose template accordingly, plus added an integration test exercising the restart path.

## Code Patterns

HAProxy runtime DNS resolution pattern: define a `resolvers` section with a `nameserver` pointing to Docker's embedded DNS (127.0.0.11:53) plus resolve/hold timeouts in haproxy/default_frontend.cfg, then attach `resolvers <name> resolve-prefer ipv4` to backend `server` lines; haproxy/entrypoint.sh templates these values at container start.

## Design Choices

Letting HAProxy re-resolve DNS at runtime via Docker's embedded DNS is preferable to restarting/reloading HAProxy whenever a backend container restarts — it leverages built-in service discovery with no external dependency and recovers routing automatically.

## Related Files

- haproxy/default_frontend.cfg
- haproxy/entrypoint.sh
- scripts/build/cht-core.yml.template
- tests/integration/api/server.spec.js
- tests/utils/index.js

## Testing

Added an integration test in tests/integration/api/server.spec.js (with supporting helpers in tests/utils/index.js) that restarts a backend container and asserts requests routed through HAProxy succeed afterward, verifying HAProxy re-resolves the backend's new IP.

## Related Issues

- #9284: HAProxy fails to route to backends after a Docker container restart because it uses a stale cached IP / does not re-resolve DNS

## Domain Rationale

**Fit:** strong

HAProxy and Docker deployment configuration is operational/deploy lifecycle work — the infrastructure domain explicitly includes Docker/HAProxy. It changes how the system is run and networked, not application behavior.

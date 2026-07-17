---
id: cht-core-8925
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 8925
issueUrl: https://github.com/medic/cht-core/issues/8925
title: Enable HTTP keep-alive in HAProxy frontend configuration
lastUpdated: '2026-06-23'
summary: HAProxy was closing connections after each request, forcing a fresh handshake per request between CouchDB clients and the proxy. Enabling http-keep-alive lets connections be reused across requests, cutting connection-setup overhead.
services:
  - api
  - sentinel
techStack:
  - haproxy
  - couchdb
tags:
  - haproxy
  - http-keep-alive
  - performance
  - connection-reuse
  - networking
  - reverse-proxy
related_workflows: []
source_pr: medic/cht-core#8942
source_sha: 2faea7b266da1844261c70d1e5fe2a6f5f1a35f2
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - haproxy/default_frontend.cfg
concepts:
  - http-keep-alive
  - persistent-connections
  - connection-reuse
  - reverse-proxy
  - tcp-connection-overhead
related_issues: []
stale: false
---

## Problem

Without keep-alive, HAProxy closed each connection after a single HTTP request/response, requiring a new TCP (and TLS) handshake for every request flowing from CouchDB clients (api, sentinel, admin) through the proxy. Under high request volume this adds per-request latency and consumes connection/port resources.

## Root Cause

The HAProxy frontend configuration in haproxy/default_frontend.cfg did not enable http-keep-alive, so connections were torn down after each request instead of being kept open and reused.

## Solution

Enabled http-keep-alive mode in haproxy/default_frontend.cfg so client- and server-side connections are kept open and reused for subsequent requests, reducing repeated connection establishment overhead for the proxy fronting CouchDB.

## Code Patterns

In HAProxy config, enable persistent connections with `option http-keep-alive` in the frontend/defaults section, ensuring no conflicting `option httpclose` / `option http-server-close` is set. File: haproxy/default_frontend.cfg.

## Design Choices

Keep-alive reuses connections rather than closing them after each exchange, trading a small amount of held-open resource for fewer TCP/TLS handshakes — favored over http-server-close for the high-volume CouchDB request pattern that benefits most from connection reuse.

## Related Files

- haproxy/default_frontend.cfg

## Testing

Config-only change; no unit or e2e tests were added. Validation relies on the staging Build CI compose images and observing the running instance under load.

## Related Issues

- #8925: enable http keep-alive in haproxy

## Domain Rationale

**Fit:** strong

The change is purely to an HAProxy frontend config file, and HAProxy is explicitly enumerated as an infrastructure concern (Docker/Helm/HAProxy) — it tunes the operational networking/proxy layer rather than any application behavior.

---
id: cht-core-8925
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 8925
issueUrl: https://github.com/medic/cht-core/issues/8925
title: Enable HTTP keep-alive in HAProxy by replacing http-server-close in the defaults section
lastUpdated: '2026-10-01'
summary: "HAProxy's defaults section set `option http-server-close`, which closes the server-side (HAProxy-to-CouchDB) connection after each response while still allowing client-side keep-alive. The PR replaces it with `option http-keep-alive`, HAProxy's default mode, so connections to CouchDB are reused across requests too."
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

Before this PR, HAProxy ran in `http-server-close` mode: it could keep client-side connections (from api and sentinel) alive, but closed the server-side connection to CouchDB after each response, so every proxied request opened a new TCP connection from HAProxy to CouchDB. Issue #8925 notes that `http-keep-alive` is HAProxy's default and `http-server-close` turns it off, that its author could not find in git history when `http-server-close` was added (the guess is early 4.x scalability testing), and that starting with Node 19, Node adds the keep-alive header to all requests.

## Root Cause

Before this PR, the `defaults` section of haproxy/default_frontend.cfg set `option http-server-close`, which turns off HAProxy's default keep-alive on the server side, so connections to CouchDB were torn down after each response instead of being kept open and reused.

## Solution

Replaced `option http-server-close` with `option http-keep-alive` in the `defaults` section of haproxy/default_frontend.cfg (a one-line change), so both client- and server-side connections are kept open and reused for subsequent requests, reducing repeated connection establishment between the proxy and CouchDB. The existing `timeout http-keep-alive 5m` in the same section bounds how long an idle kept-alive connection is held.

## Code Patterns

In HAProxy config, enable persistent connections with `option http-keep-alive` in the `defaults` section, replacing rather than adding alongside `option http-server-close`. Keep an explicit `timeout http-keep-alive` (here `5m`) so idle keep-alive connections are not governed by the much longer `timeout client 15000000` in the same section. File: haproxy/default_frontend.cfg.

## Design Choices

Keep-alive reuses connections rather than closing them after each exchange, trading a small amount of held-open resource for fewer TCP connection setups; the PR returns HAProxy to its default mode instead of keeping the untraced `http-server-close` override.

## Related Files

- haproxy/default_frontend.cfg

## Testing

Config-only change (one line in haproxy/default_frontend.cfg); the PR adds no unit or e2e tests.

## Related Issues

- #8925: "Enable http-keep-alive in haproxy" — the issue this PR implements

## Domain Rationale

**Fit:** strong

The change is purely to the HAProxy config file haproxy/default_frontend.cfg — it tunes how the proxy in front of CouchDB manages connections, the operational networking/proxy layer rather than any application behavior.

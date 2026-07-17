---
id: cht-core-8868
category: bug
domain: authentication
domainFit: strong
issueNumber: 8868
issueUrl: https://github.com/medic/cht-core/issues/8868
title: Stop forwarding the content-length header on the authentication GET /_session request to avoid haproxy truncating reused keep-alive connections
lastUpdated: '2026-06-23'
summary: When authenticating a user, API forwarded all original request headers — including content-length from POST requests — onto CouchDB's GET /_session, which made haproxy truncate the next request on reused keep-alive connections and return HTTP 400. The fix stops forwarding the content-length header on that session request.
services:
  - api
techStack:
  - nodejs
  - javascript
  - couchdb
  - haproxy
  - docker
tags:
  - authentication
  - http-headers
  - content-length
  - keep-alive
  - haproxy
  - session
  - header-forwarding
  - node-19
related_workflows: []
source_pr: medic/cht-core#8933
source_sha: 30530e89ff788beeec3b6ef5dcf28a4889fb5e15
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/auth.js
concepts:
  - HTTP keep-alive connection reuse
  - request framing via content-length
  - authentication header forwarding to CouchDB _session
  - hop-by-hop vs end-to-end headers
  - HAProxy request truncation
related_issues: []
stale: false
---

## Problem

Accessing the API directly or through an AWS load balancer (but never through nginx) caused authenticated POST requests to intermittently fail with HTTP 400. Node 19 enables keep-alive on outgoing requests by default, which makes the content-length header significant for connection reuse; on a reused connection haproxy would consume content-length characters from the following request, leaving a truncated, malformed request that errored with 400.

## Root Cause

In api/src/auth.js the user-authentication logic copies ALL headers from the original client request onto the GET /_session request (to avoid enumerating every auth mechanism — cookie, authorization, etc.). For POST requests this included content-length. With Node 19's default keep-alive, that spurious content-length on a bodyless GET corrupted HTTP request framing on reused connections, causing haproxy to mis-parse and truncate the subsequent request.

## Solution

Modified api/src/auth.js so the content-length header is no longer forwarded when constructing the GET /_session authentication request, leaving the bodyless GET without a body-length header so reused keep-alive connections frame the next request correctly.

## Code Patterns

When forwarding a client's headers onto an internal sub-request, strip body-framing/hop-by-hop headers (notably content-length) that do not apply to the new request — especially for GET requests that carry no body. See the header-filtering logic in api/src/auth.js.

## Design Choices

Instead of switching to an allowlist that forwards only auth-relevant headers (cookie, authorization, etc.), the broad forward-everything behavior was kept and only the problematic content-length header was surgically removed — a minimal, low-risk change that fixes the framing bug without regressing the various authentication mechanisms that rely on arbitrary forwarded headers.

## Related Files

- api/src/auth.js
- api/tests/mocha/auth.spec.js
- tests/integration/haproxy/keep-alive.spec.js
- tests/integration/haproxy/keep-alive-script/Dockerfile
- tests/integration/haproxy/keep-alive-script/cmd.sh
- tests/integration/haproxy/keep-alive-script/docker-compose.yml

## Testing

Updated unit tests in api/tests/mocha/auth.spec.js to assert content-length is not forwarded on the _session request. Added a new integration test (tests/integration/haproxy/keep-alive.spec.js) backed by a dedicated keep-alive-script Docker setup (Dockerfile, cmd.sh, docker-compose.yml) that reproduces the haproxy keep-alive connection-reuse scenario and verifies subsequent requests are no longer truncated or returned as 400.

## Related Issues

- #8868: POST requests fail with HTTP 400 over reused haproxy/AWS-load-balancer keep-alive connections because the auth GET /_session request forwarded the original request's content-length header

## Domain Rationale

**Fit:** strong

Both the bug and the fix live in api/src/auth.js in the user-authentication path that forwards client headers to CouchDB's GET /_session; although the symptom surfaces as an HTTP keep-alive/haproxy truncation issue, the changed code is the authentication header-forwarding logic, not operational/HAProxy deployment config (so it is not infrastructure).

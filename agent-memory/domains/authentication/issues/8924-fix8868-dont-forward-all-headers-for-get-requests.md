---
id: cht-core-8924
category: bug
domain: authentication
domainFit: strong
issueNumber: 8924
issueUrl: https://github.com/medic/cht-core/issues/8924
title: Stop forwarding content-length header on GET /_session authentication request to prevent HAProxy request truncation under keep-alive
lastUpdated: '2026-06-23'
summary: Authenticating a user forwarded all original request headers (including content-length from POSTs) to a GET /_session request, which under Node 19's default keep-alive caused HAProxy to truncate the next request on the reused connection and return 400 errors. The fix stops forwarding the content-length header on the session request.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - haproxy
  - http
  - docker
  - mocha
tags:
  - http-headers
  - content-length
  - keep-alive
  - session-authentication
  - haproxy
  - node-19
  - connection-reuse
  - reverse-proxy
  - request-truncation
related_workflows: []
source_pr: medic/cht-core#8924
source_sha: 831bd6e8a65900a95126a3224f9ebb5ef9968180
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/auth.js
  - tests/integration/haproxy/keep-alive.spec.js
concepts:
  - session authentication via GET /_session
  - HTTP header forwarding/proxying
  - HTTP keep-alive persistent connections
  - content-length and connection reuse
  - reverse proxy (HAProxy) request framing
related_issues: []
stale: false
---

## Problem

When authenticating a user, the API copied all headers from the original request onto a GET /_session request sent to CouchDB. If the original request was a POST carrying a content-length header, that header was forwarded onto the bodyless GET. Under Node 19 (which enables keep-alive by default), the proxy (HAProxy) reused the connection and truncated content-length characters from the following request, treating the prior request as unfinished, producing an invalid request and a 400 status code. It manifested only when hitting API directly or via the AWS load balancer, never through nginx.

## Root Cause

In api/src/auth.js, the code that builds the GET /_session authentication request indiscriminately forwarded all of the user's original request headers (to avoid having to enumerate every auth mechanism such as cookie/authorization). For a GET with no body, the forwarded content-length is semantically wrong, and combined with keep-alive connection reuse it caused the downstream proxy to mis-frame subsequent requests on the same connection.

## Solution

Modified api/src/auth.js so the content-length header is no longer forwarded when constructing the GET /_session session request, while still passing through the auth-bearing headers (cookie, authorization, etc.).

## Code Patterns

When proxying/forwarding headers from one request to a derived request, strip headers that do not apply to the new request's method/body — notably remove content-length for bodyless GET requests to avoid corrupting connection framing under keep-alive. See api/src/auth.js.

## Design Choices

Rather than switching to an allowlist of only the auth headers needed for /_session (which would require knowing every supported authentication method), the fix keeps the existing forward-everything approach but blocks the single problematic header (content-length). This preserves support for arbitrary auth mechanisms while removing the one header that breaks keep-alive connection reuse.

## Related Files

- api/src/auth.js
- api/tests/mocha/auth.spec.js
- tests/integration/haproxy/keep-alive.spec.js
- tests/integration/haproxy/keep-alive-script/Dockerfile
- tests/integration/haproxy/keep-alive-script/cmd.sh
- tests/integration/haproxy/keep-alive-script/docker-compose.yml

## Testing

Unit tests updated in api/tests/mocha/auth.spec.js to assert the content-length header is not forwarded on the session request. A new integration test tests/integration/haproxy/keep-alive.spec.js, backed by a dedicated docker-compose setup (Dockerfile, cmd.sh, docker-compose.yml), reproduces the HAProxy keep-alive connection-reuse scenario to confirm subsequent requests are no longer truncated.

## Related Issues

- #8868: requests truncated and returning 400 due to content-length header being forwarded onto the GET /_session auth request under Node 19 keep-alive when hitting API directly or via AWS load balancer

## Domain Rationale

**Fit:** strong

The fix lives in api/src/auth.js and changes how the user session-authentication request (GET /_session) forwards headers, so it squarely belongs to authentication. The haproxy/keep-alive symptom is only where the transport bug surfaces; per guidance, in-application auth code stays in its functional domain rather than being pushed into infrastructure just because HAProxy is involved.

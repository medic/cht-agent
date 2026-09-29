---
id: cht-core-8868
category: bug
domain: authentication
domainFit: strong
issueNumber: 8868
issueUrl: https://github.com/medic/cht-core/issues/8868
title: Stop forwarding content-length header on GET /_session authentication request to prevent HAProxy request truncation under keep-alive
lastUpdated: '2026-09-29'
summary: Authenticating a user forwarded all original request headers (including content-length from POSTs) to a GET /_session request, which under Node 19's default keep-alive caused HAProxy to truncate the next request on the reused connection and return 400 errors. The fix stops forwarding the content-length header on the session request. It reached users in 4.6.0 through the 4.6.x backport medic/cht-core#8933 (first tagged 4.6.0-beta.3) and in 4.7.0 from master.
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
source_prs:
  - "medic/cht-core#8924"
  - "medic/cht-core#8933"
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

When authenticating a user, the API copied all headers from the original request onto a GET /_session request sent to CouchDB. If the original request was a POST carrying a content-length header, that header was forwarded onto the bodyless GET. Under Node 19 (which enables keep-alive by default), api's connection to HAProxy was reused, and HAProxy, treating the bodyless GET as unfinished, consumed content-length characters of the following request on that connection, producing an invalid request and a 400 status code. It was observed only when hitting API directly or via the AWS load balancer, never through nginx. Issue #8868 reported it after upgrading to 4.6.0-beta.2: users could not log in to the webapp and authenticated REST API calls failed with 400.

## Root Cause

In api/src/auth.js, the code that builds the GET /_session authentication request indiscriminately forwarded all of the user's original request headers (to avoid having to enumerate every auth mechanism such as cookie/authorization). For a GET with no body, the forwarded content-length is semantically wrong, and combined with keep-alive connection reuse it caused the downstream proxy to mis-frame subsequent requests on the same connection.

## Solution

Modified the private `get` helper in api/src/auth.js (`const get = (path, headers) =>`), which `getUserCtx(req)` calls as `get('/_session', req.headers)`: it now copies the headers and deletes every key matching `contentLengthRegex = /^content-length$/i` (any casing) before the request, while still passing through the auth-bearing headers (cookie, authorization, etc.). Backported to the 4.6.x release branch as PR #8933 (`30530e89f`, cherry-picked from the master commit `831bd6e8a` with an identical patch); 4.6.0 was the first release to include it, and the master commit first shipped in 4.7.0.

On master `get()` also strips `content-type` (`contentTypeRegex = /^content-type$/i`, added by PR #9746, which replaced request-promise-native with fetch) and sends the request through `@medic/couch-request`, so the header denylist is now two names.

## Code Patterns

When proxying/forwarding headers from one request to a derived request, strip headers that do not apply to the new request's method/body — notably remove content-length for bodyless GET requests to avoid corrupting connection framing under keep-alive, and match header names case-insensitively (`/^content-length$/i`; the unit test checks five casings). See `get()` in api/src/auth.js.

## Design Choices

Rather than switching to an allowlist of only the auth headers needed for /_session (which would require knowing every supported authentication method), the fix keeps the existing forward-everything approach but blocks the single problematic header (content-length; on master `content-type` is blocked too). This preserves support for arbitrary auth mechanisms while removing the one header that breaks keep-alive connection reuse.

## Related Files

- api/src/auth.js
- api/tests/mocha/auth.spec.js
- tests/integration/haproxy/keep-alive.spec.js
- tests/integration/haproxy/keep-alive-script/Dockerfile
- tests/integration/haproxy/keep-alive-script/cmd.sh
- tests/integration/haproxy/keep-alive-script/docker-compose.yml

## Testing

Unit tests in api/tests/mocha/auth.spec.js gained a `getUserCtx` block, including `should clean content-length headers before forwarding`, which sets `content-length`, `Content-Length`, `Content-length`, `content-Length` and `CONTENT-LENGTH` on the request and asserts none reaches the `/_session` GET. A new integration test tests/integration/haproxy/keep-alive.spec.js runs a small docker-compose service (tests/integration/haproxy/keep-alive-script/: Dockerfile, cmd.sh, docker-compose.yml) on the e2e network and asserts its output contains no `HTTP/1.1 400 Bad Request` but does contain `HTTP/1.1 302 Found`, `Connection: keep-alive`, `Set-Cookie: AuthSession=` and `Set-Cookie: userCtx=`. The service's tests/integration/haproxy/keep-alive-script/cmd.sh curls a JSON login POST to `'http://api:5988/medic/login'` straight to api, bypassing nginx.

## Related Issues

- #8868: "Session requests failing after upgrade" — the issue both PRs fix; requests truncated and returning 400 because content-length was forwarded onto the GET /_session auth request under Node 19 keep-alive

## Domain Rationale

**Fit:** strong

The fix lives in api/src/auth.js and changes how the user session-authentication request (GET /_session) forwards headers, so it squarely belongs to authentication. The haproxy/keep-alive symptom is only where the transport bug surfaces; in-application auth code stays in its functional domain rather than being pushed into infrastructure just because HAProxy is involved.

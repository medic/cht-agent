---
id: cht-core-9286
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9286
issueUrl: https://github.com/medic/cht-core/issues/9286
title: Remove ineffective request timeout property from setup view-indexer (didn't terminate requests at HAProxy level)
lastUpdated: '2026-06-22'
summary: The setup view-indexer passed a request timeout property meant to terminate long-running CouchDB view indexing requests, but the timeout never terminated the request at the HAProxy level. The fix removes the ineffective timeout property and updates the unit test.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - haproxy
  - mocha
tags:
  - view-indexer
  - request-timeout
  - haproxy
  - couchdb-views
  - upgrade
  - setup
  - view-warming
related_workflows: []
source_pr: medic/cht-core#9634
source_sha: ac1147c4f45d316eb67316aa2a313990b2b62c5b
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/setup/view-indexer.js
concepts:
  - CouchDB view indexing/warming
  - HAProxy request timeout
  - upgrade/setup lifecycle
  - client vs proxy timeout semantics
related_issues: []
stale: false
---

## Problem

During CHT setup/upgrade, the view-indexer passed a request timeout property when triggering CouchDB view indexing. The timeout was intended to terminate long-running indexing requests, but it did not actually terminate the request at the HAProxy level, so it had no useful effect and could cause the client to abandon a request while indexing continued behind the proxy.

## Root Cause

The timeout property only governed the client-side HTTP request, not the indexing operation proxied through HAProxy. HAProxy did not honor/terminate the indexing based on this client timeout, making the property ineffective for its stated purpose of terminating the request.

## Solution

Removed the request timeout property from the view indexing request in api/src/services/setup/view-indexer.js, allowing the indexing request to proceed without an ineffective client-side timeout, and updated the corresponding mocha unit test to match.

## Code Patterns

When a client-side request timeout cannot actually terminate a long-running server operation proxied through HAProxy, do not pass it — it provides a false sense of control without stopping the work. Enforce such cutoffs at the proxy/server tier instead. See api/src/services/setup/view-indexer.js.

## Design Choices

Rather than reconfiguring HAProxy to honor and enforce the timeout, the simpler, lower-risk fix was to drop the non-functional client timeout entirely and let view indexing run to completion.

## Related Files

- api/src/services/setup/view-indexer.js
- api/tests/mocha/services/setup/view-indexer.spec.js

## Testing

Updated the existing mocha unit test (api/tests/mocha/services/setup/view-indexer.spec.js) to assert the request timeout property is no longer passed when triggering view indexing.

## Related Issues

- #9286: view-indexer request timeout did not terminate the indexing request at the HAProxy level
- #9617: related view-indexing/timeout issue referenced by the PR
- #8573: related view-indexing/timeout issue referenced by the PR

## Domain Rationale

**Fit:** strong

The change lives in the setup/upgrade tooling (api/src/services/setup/view-indexer.js) and concerns an HAProxy-level request timeout — both upgrade tooling and HAProxy are squarely operational-lifecycle (infrastructure) concerns. It is not index-document/B-tree design (which would be data-sync), so the data-layer-internals pitfall does not apply.

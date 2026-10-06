---
id: cht-core-9286
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9286
issueUrl: https://github.com/medic/cht-core/issues/9286
title: Remove ineffective request timeout property from setup view-indexer (didn't terminate requests at HAProxy level)
lastUpdated: '2026-10-05'
summary: During upgrades and installs the setup view-indexer queried each staged view with a 2-second request timeout and re-sent the query after every socket timeout, but the timeout never terminated the request at the HAProxy level, so view queries could pile up while indexing ran (issue 9286 reports CouchDB becoming unreachable). The fix removes the timeout property and updates the unit test.
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
  - client-side request timeout behind HAProxy
  - upgrade/setup lifecycle
  - client vs proxy timeout semantics
related_issues:
  - cht-core-9617
  - cht-core-8573
  - cht-core-9284
stale: false
---

## Problem

Issue #9286: starting an upgrade that involves view indexing could make CouchDB (2.x, on a database of 33M docs) stop serving requests without a crash log, with HAProxy logging NOSRV for every incoming request. The reporter suspected API was queuing too many requests because of the request timeout in api/src/services/setup/view-indexer.js, which, the reporter believed, does not cancel the request at the CouchDB level. During view warming, the view-indexer passed that timeout when querying each staged view; the PR notes it did not actually terminate the request at the HAProxy level, so the client abandoned requests while indexing continued behind the proxy.

## Root Cause

Before this PR, `indexView` in api/src/services/setup/view-indexer.js called `request.get` with `timeout: 2000` and, when the error code was one of `SOCKET_TIMEOUT_ERROR_CODE` (`'ESOCKETTIMEDOUT'`, `'ETIMEDOUT'`), sent the same query again for as long as `continueIndexing` was true. The timeout only governed the client side: the abandoned query kept running behind HAProxy, so every 2 seconds each view still being indexed gained another in-flight query, and `indexViews` starts all staged views at once with `Promise.all`.

## Solution

Removed the request timeout property (`timeout: 2000`) from the view indexing request in api/src/services/setup/view-indexer.js, so the client no longer abandons and re-sends each view query every 2 seconds, and updated the corresponding mocha unit test to match. The retry on socket-timeout errors is unchanged.

## Code Patterns

When a client-side request timeout cannot actually terminate a long-running server operation proxied through HAProxy, do not pass it — it provides a false sense of control without stopping the work, and paired with retry-on-timeout it multiplies in-flight requests. View warming sends one `qs: { limit: 1 }` query per view and lets it wait for the index, re-sending only after a socket-timeout error. See api/src/services/setup/view-indexer.js.

## Design Choices

The PR drops the client timeout outright rather than raising its value, and lets view indexing run to completion. The retry on `ESOCKETTIMEDOUT` or `ETIMEDOUT` stays, so a socket timeout raised elsewhere still re-sends the query until it succeeds or `stopIndexing` sets `continueIndexing` to false.

## Related Files

- api/src/services/setup/view-indexer.js
- api/tests/mocha/services/setup/view-indexer.spec.js

## Testing

Updated the existing mocha unit test (api/tests/mocha/services/setup/view-indexer.spec.js) to assert the request timeout property is no longer passed when triggering view indexing: `timeout: 2000` was removed from every expected request, and `should query the view with a timeout` was renamed `should query the view`.

## Related Issues

- #9617: "Starting an upgrade that involves view indexing can become stuck after indexing is finished" — listed in this PR's description; the upgrade stalls after view indexes are built and the upgrade log has to be moved from `indexing` to `indexed` by hand.
- #8573: "Install button doesn't appear after staging an upgrade sometimes" — listed in this PR's description; after staging, the last logged step stays at indexing views and the install button does not appear.
- #9284: "CouchDb restart causes all services to go down" — cited in this draft's issue ("I believe this is also happening") after haproxy and CouchDB were restarted; fixed by PR #9288

## Domain Rationale

**Fit:** strong

The change lives in the setup/upgrade tooling (api/src/services/setup/view-indexer.js) and concerns how upgrade view warming loads CouchDB through HAProxy — both upgrade tooling and HAProxy are squarely operational-lifecycle (infrastructure) concerns. It changes no view definitions or replication code, only how the upgrade process queries staged views.

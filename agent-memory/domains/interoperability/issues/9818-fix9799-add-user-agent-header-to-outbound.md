---
id: cht-core-9799
category: feature
domain: interoperability
domainFit: strong
issueNumber: 9799
issueUrl: https://github.com/medic/cht-core/issues/9799
title: Add versioned User-Agent header and configurable HTTP headers to outbound push
lastUpdated: '2026-06-22'
summary: Outbound push could only set an authorization header and sent no User-Agent, but external integrations sometimes require specific headers. This adds a default User-Agent header carrying the CHT version plus support for configurable headers, exposing the version via a new getVersion() in shared-libs/environment.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - mocha
tags:
  - outbound-push
  - user-agent
  - http-headers
  - versioning
  - external-integration
related_workflows: []
source_pr: medic/cht-core#9818
source_sha: 9bcc58a5b8b1c8311a4c70c039dd393e43754dd4
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/outbound/src/outbound.js
  - shared-libs/environment/src/index.js
  - api/src/services/deploy-info.js
concepts:
  - outbound push integration
  - HTTP request headers
  - User-Agent versioning
  - shared-library code reuse
  - version detection
related_issues: []
stale: false
---

## Problem

Outbound push to external systems could not add or change HTTP headers other than authorization, and sent no User-Agent header at all. Some third-party integrations require a specific User-Agent (e.g. 'CHT-Integration/1.0 libwww/2.17b3'), which was impossible to provide.

## Root Cause

The outbound module hardcoded its request headers and only supported authorization, with no mechanism to merge in configured headers or emit a User-Agent. The CHT version needed for a meaningful User-Agent string was only computed in api/src/services/deploy-info.js and was not reachable from shared-libs.

## Solution

Added a default User-Agent header that embeds the CHT version to outbound requests and allowed configured headers to be supplied/overridden. To obtain the version from shared code, a getVersion() helper was added to shared-libs/environment (mirroring deploy-info.js's logic, with minor accepted duplication) and consumed by both deploy-info.js and the outbound library.

## Code Patterns

getVersion() in shared-libs/environment/src/index.js exposes the CHT version to any shared library; shared-libs/outbound/src/outbound.js builds a versioned User-Agent string and merges configured headers over defaults. api/src/services/deploy-info.js reuses the shared version helper to reduce duplication.

## Design Choices

The author placed getVersion() in shared-libs/environment rather than spinning up a new shared-lib, accepting small duplication of deploy-info.js's version logic since that code wasn't importable from shared-libs. Including the version in the User-Agent (vs. omitting it to avoid mess) was deemed a worthwhile, low-cost addition.

## Related Files

- api/src/services/deploy-info.js
- api/tests/mocha/services/deploy-info.spec.js
- shared-libs/environment/src/index.js
- shared-libs/environment/test/index.spec.js
- shared-libs/outbound/src/outbound.js
- shared-libs/outbound/test/outbound.spec.js

## Testing

Unit tests (Mocha) added/updated across all three modules: deploy-info.spec.js for version retrieval, environment/test/index.spec.js for the new getVersion() helper, and outbound/test/outbound.spec.js verifying the User-Agent header is set with the version and that configured headers are applied.

## Related Issues

- #9799: Outbound push needs to support adding/changing HTTP headers such as User-Agent, not just authorization

## Domain Rationale

**Fit:** strong

Outbound push is CHT's core mechanism for integrating with external/third-party web services over HTTP; adding and customizing HTTP headers (User-Agent) on those outbound requests is squarely an interoperability concern. The configuration angle (headers set in app settings) is secondary to the integration behavior being changed.

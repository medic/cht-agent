---
id: cht-core-9527
category: bug
domain: authentication
domainFit: strong
issueNumber: 9527
issueUrl: https://github.com/medic/cht-core/issues/9527
title: Treat malformed privacy policy document as a 404 instead of logging a custom error
lastUpdated: '2026-06-22'
summary: When the privacy policy document was malformed, the API's privacy-policy service surfaced a custom error and logged it, producing noisy/misleading error logs. The fix treats a malformed privacy policy doc as a 404 (not found) so it degrades gracefully without erroneous logging.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - mocha
tags:
  - privacy-policy
  - error-handling
  - '404'
  - malformed-document
  - logging
related_workflows:
  - observability
source_pr: medic/cht-core#9671
source_sha: fd83165ace19b618300179569d12858207a72225
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/privacy-policy.js
  - api/src/errors.js
  - api/src/public-error.js
  - api/src/services/records.js
concepts:
  - error handling
  - HTTP status codes
  - graceful degradation
  - shared error abstractions
  - privacy policy access gate
related_issues: []
stale: false
---

## Problem

When the privacy policy document stored in CouchDB was malformed (e.g. invalid/unexpected structure), the API privacy-policy service raised a custom error and logged it, generating noisy and misleading error-log entries and returning a non-standard error response during the login/access flow rather than failing gracefully.

## Root Cause

The privacy-policy service did not distinguish a malformed/unusable policy document from a genuine server error, so it threw and logged a custom error instead of treating an unusable policy as 'not found'. The shared error abstractions in errors.js/public-error.js needed to support mapping this case to a 404.

## Solution

Changed the privacy-policy service to treat a malformed privacy policy document as a 404 (not found) instead of raising a logged custom error. Updated the shared error classes (api/src/errors.js, api/src/public-error.js) to support this mapping, aligned api/src/services/records.js (which shares those error abstractions) with the refactored API, and updated unit tests in privacy-policy.spec.js.

## Code Patterns

Map malformed or missing config-style documents to appropriate HTTP status codes (404) via the shared error helpers in api/src/public-error.js and api/src/errors.js rather than throwing and logging generic/custom errors. Differentiate expected 'data not usable' conditions from true server errors to avoid log noise; centralizing this in shared error classes keeps consumers (privacy-policy.js, records.js) consistent.

## Design Choices

Treating a malformed policy doc as 404 (instead of 500/custom error) makes failure graceful — clients behave as if no policy exists — and stops the malformed-doc case from polluting error logs. Implementing it in the shared error abstractions keeps privacy-policy.js and records.js consistent rather than special-casing one service.

## Related Files

- api/src/services/privacy-policy.js
- api/src/errors.js
- api/src/public-error.js
- api/src/services/records.js
- api/tests/mocha/services/privacy-policy.spec.js

## Testing

Updated Mocha unit tests in api/tests/mocha/services/privacy-policy.spec.js to assert that a malformed privacy policy document results in a 404 and does not emit an error log.

## Related Issues

- #9527: don't log error when privacy policy doc is malformed — treat the malformed doc as a 404

## Domain Rationale

**Fit:** strong

The privacy policy is CHT's consent gate served during the login/access flow — users must accept it before using the app — so the API privacy-policy service lives in the authentication/access subsystem. The policy content is admin-configured (config-adjacent), but this PR changes the runtime serving/error path, not the configuration of the policy, so authentication is the principled home; configuration only supplies the policy content.

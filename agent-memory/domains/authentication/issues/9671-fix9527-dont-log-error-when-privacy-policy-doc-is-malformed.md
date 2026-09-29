---
id: cht-core-9527
category: bug
domain: authentication
domainFit: weak
issueNumber: 9527
issueUrl: https://github.com/medic/cht-core/issues/9527
title: Treat a privacy-policies doc with no policies as a 404 instead of logging an error
lastUpdated: '2026-09-29'
summary: When the `privacy-policies` doc existed but had a missing or empty `privacy_policies` property, the API's privacy-policy service threw a plain `Error` that its own catch passed to `logger.error`, so every login-page render (including service-worker generation) logged a misleading error. The fix throws a new `NotFoundError` (status 404) instead, which that catch does not log, so the doc is treated exactly like a missing one.
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
  - privacy policy existence check on the login page
related_issues: []
stale: false
---

## Problem

When the `privacy-policies` doc in the medic database existed but lacked a non-empty `privacy_policies` property (for example after an empty privacy-policies.json configuration was uploaded), the API logged `Invalid privacy-policies doc: missing required "privacy_policies" property` as an error. The error is harmless — the login page simply shows no privacy-policy link — but issue #9527 reports it caused confusion and was often mistaken for an API crash. It was logged on every login-page render, including the one done during service-worker generation, and `GET /medic/privacy-policy` answered 500.

## Root Cause

`getDoc()` in api/src/services/privacy-policy.js threw a plain `Error` when the doc had no policies, and its `.catch` logs every error whose `status` is not 404 before rethrowing — so a doc that is present but unusable was logged like a genuine server error, while a missing doc (a PouchDB 404) was silent. api had no error class carrying a 404 status.

## Solution

Added api/src/errors.js with a `NotFoundError` class that sets both `status` and `statusCode` to 404 (commented as simulating PouchDB and request errors), and made `getDoc()` throw `NotFoundError` for a doc without policies, so the catch no longer logs it. `exists()` still returns false, so the login page shows no policy link, and `GET /medic/privacy-policy` now responds 404 through `serverUtils.error` instead of 500. `PublicError` moved from api/src/public-error.js (deleted) into api/src/errors.js, and api/src/services/records.js — the only module that imported it — now requires `{ PublicError }` from `../errors`. The issue suggested logging a warning with configuration guidance; the PR instead stops logging this case at all.

## Code Patterns

Give an expected absence its own error type that looks like the platform's not-found errors: `NotFoundError` (api/src/errors.js) sets `status` (PouchDB style) and `statusCode` (request style) to 404, so existing checks such as the `err.status !== 404` log filter in api/src/services/privacy-policy.js and `serverUtils.error()` (which reads `err.code || err.statusCode || err.status`) treat a present-but-unusable doc exactly like a missing one, with no special-casing at the call sites. Differentiate expected 'data not usable' conditions from true server errors to avoid log noise. api/src/errors.js became api's shared module for error classes; on master it also holds `PermissionError`, `AuthenticationError`, `ContentTypeError`, `BadRequestError` and `PayloadTooLargeError`.

## Design Choices

Treating a malformed policy doc as 404 (instead of a logged plain `Error` and a 500 from the endpoint) makes failure graceful — clients behave as if no policy exists — and stops the malformed-doc case from polluting error logs. `PublicError` was moved into the same new module rather than left in its own file, so api's error classes live in one place.

## Related Files

- api/src/services/privacy-policy.js
- api/src/errors.js (added)
- api/src/public-error.js (deleted)
- api/src/services/records.js
- api/tests/mocha/services/privacy-policy.spec.js

## Testing

Added three Mocha unit cases to api/tests/mocha/services/privacy-policy.spec.js — the doc does not exist, `privacy_policies` is empty, and the property is missing — each asserting that `get()` rejects with status 404 and that `logger.error` is not called.

## Related Issues

- #9527: "API logs error when privacy policies doc contains no privacy policies" — the issue this PR closes

## Domain Rationale

**Fit:** weak

The change is error classification and logging in api/src/services/privacy-policy.js: a present-but-empty `privacy-policies` doc now throws a 404 `NotFoundError` instead of a logged plain `Error`. It touches no credential, session or access handling. Authentication is the least-bad home because one of the service's two consumers is the login page render (`privacyPolicy.exists()` in api/src/controllers/login.js decides whether the login page links to the policy); configuration is the other candidate, since the doc is admin-uploaded content, but the PR changes no settings or configuration handling.

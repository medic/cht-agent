---
id: cht-core-9618
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9618
issueUrl: https://github.com/medic/cht-core/issues/9618
title: Prevent API from crashing on startup when a form is broken/invalid
lastUpdated: '2026-06-22'
summary: A single broken or invalid form would throw during the API startup sequence and crash the whole API service. The fix isolates per-form failures so a broken form is logged and skipped while the API continues starting up.
services:
  - api
techStack:
  - nodejs
  - javascript
  - express
  - couchdb
tags:
  - api-startup
  - error-handling
  - forms
  - resilience
  - crash
  - graceful-degradation
  - xform
related_workflows: []
source_pr: medic/cht-core#9641
source_sha: a9aea1eedbc3976729cca91dcba5a18edfa120bd
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/server.js
concepts:
  - api-startup
  - bootstrap-sequence
  - error-handling
  - graceful-degradation
  - fault-tolerance
  - form-processing
related_issues: []
stale: false
---

## Problem

If any configured form was broken or invalid (e.g. malformed XForm/XML), the API threw an unhandled error during its startup sequence and crashed, preventing the entire API service from coming up. One bad form could take down the whole instance.

## Root Cause

During API startup in api/server.js, the form processing/initialization step ran without isolating per-form failures, so an exception raised by a single broken form propagated up and aborted the entire startup sequence instead of being contained to that form.

## Solution

The startup form-processing step was made fault-tolerant: a broken/invalid form is now caught and logged rather than allowed to throw, so the API continues its startup sequence and comes up successfully. The offending form is skipped while remaining initialization proceeds normally.

## Code Patterns

Fail-soft bootstrap: wrap per-item work in a startup loop (form processing in api/server.js) with try/catch so one bad item logs an error and is skipped rather than aborting the whole startup. Treat non-critical initialization as best-effort and keep the service-availability path resilient to bad configuration data.

## Design Choices

Chose graceful degradation (log and skip the broken form, continue startup) over fail-fast, prioritizing API availability — a single misconfigured form should not block the entire instance from starting. Errors are still logged so the broken form remains diagnosable.

## Related Files

- api/server.js
- tests/integration/api/server.spec.js

## Testing

Added an integration test in tests/integration/api/server.spec.js asserting that the API server starts successfully even when a form is broken (per the branch name, 'api should start with broken forms'), covering the previously crashing startup path.

## Related Issues

- #9618: API crashes on startup when a form is broken

## Domain Rationale

**Fit:** strong

The bug is triggered by broken/invalid form definitions and the fix isolates form-processing failures during API startup, so forms are the clear subject and forms-and-reports is the most specific functional domain. It is not infrastructure, since that bucket is reserved for operational lifecycle (CI/build/deploy/upgrade) rather than application runtime error handling.

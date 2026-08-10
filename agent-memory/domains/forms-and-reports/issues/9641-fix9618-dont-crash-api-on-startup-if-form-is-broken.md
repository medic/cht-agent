---
id: cht-core-9618
category: bug
domain: forms-and-reports
domainFit: weak
issueNumber: 9618
issueUrl: https://github.com/medic/cht-core/issues/9618
title: Prevent API from crashing on startup when a form is broken/invalid
lastUpdated: '2026-08-10'
summary: A single broken or invalid form would throw during the API's xform-regeneration step, which shared a try/catch with the rest of the bootstrap whose handler called process.exit(1), crashing the whole API service. The fix moves xform regeneration into its own try/catch that only logs, so the API still comes up.
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

On startup the API regenerates the model.xml and form.html attachments for every form: doc from its xml attachment. If any of those xml attachments was invalid in a way xsltproc could not convert (the reported case was a stray apostrophe inside a tag, uploaded via upload-*-forms --skip-validate), the regeneration error was caught by the bootstrap's fatal handler, which exited the process — so the entire API service failed to come up. One bad form could take down the whole instance, and because the API usually fronts CouchDB, there was no easy way to upload a corrected form to recover.

## Root Cause

During API startup in api/server.js, xform regeneration ran inside the same try/catch as the rest of the bootstrap (migrations, manifest, service worker), whose handler logged 'Fatal error initialising API' and called process.exit(1). Any error thrown while regenerating a single form's model.xml/form.html attachments therefore killed the whole startup.

## Solution

The xform-regeneration step was split into its own try/catch that logs 'Error initialising API' and falls through instead of exiting, so a broken form no longer prevents the API from coming up; the migrations/manifest/service-worker steps keep the original fatal handling and still exit(1). Note that generateXform.updateAll() still aborts at the first broken form — its per-doc work is a promise reduce that rejects as a unit — so forms after it in the batch are left with their existing attachments. The API survives; the remaining forms are not individually rescued, and (unlike the option floated in the issue) stale model.xml/form.html attachments are not stripped from the offending doc.

## Code Patterns

Fail-soft bootstrap by partitioning the startup sequence: keep must-succeed steps under a fatal try/catch that exits, and move best-effort steps (xform regeneration in api/server.js) into a separate try/catch that only logs. Treat non-critical initialization as best-effort and keep the service-availability path resilient to bad configuration data.

## Design Choices

Chose graceful degradation (log the failure, continue startup) over fail-fast for the xform-regeneration step, prioritizing API availability — a single misconfigured form should not block the entire instance from starting, especially since the API is usually the proxy for CouchDB traffic and a crashed API leaves no route to fix the bad attachment. Kept fail-fast for migrations, manifest and service-worker generation, where continuing would leave the instance in an unusable state. Errors are still logged so the broken form remains diagnosable. The issue also proposed deleting the stale model.xml/form.html attachments so users get the standard 'missing required attachments' form error; that was not implemented here.

## Related Files

- api/server.js
- tests/integration/api/server.spec.js

## Testing

Added an integration test 'should start up with broken forms' in tests/integration/api/server.spec.js: it PUTs a doc whose `_id` is built as ``form:${formName}`` with `formName = 'broken'`, carrying an `xml` attachment of `btoa('this is totally not an xml')` (bypassing utils.saveDoc, which waits for good forms), waits for the 'Failed to update xform' log, then stops and restarts the API and asserts it comes back up — covering the previously crashing startup path.

## Related Issues

- #9618: a broken form.xml attachment can prevent the api server from starting — xsltproc fails to regenerate model.xml/form.html and the error aborts startup

## Domain Rationale

**Fit:** weak

The fix is API startup resilience (isolating a failing form-processing step so the whole service survives); broken forms are the trigger rather than the subject, so forms-and-reports is the least-bad home rather than a principled fit.

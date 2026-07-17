---
id: cht-core-10679
category: bug
domain: forms-and-reports
domainFit: weak
issueNumber: 10679
issueUrl: https://github.com/medic/cht-core/issues/10679
title: Prevent weak-GPS geolocation timeout from blocking form submission by resolving complete() immediately with a sentinel -1 code
lastUpdated: '2026-06-22'
summary: 'The geolocation service blocked form submission for up to 30 seconds waiting for the GPS watcher when signal was weak, leading some deployments to disable GPS entirely. complete() now resolves immediately with {code: -1, ''Geolocation not yet acquired''} and nulls the deferred so late callbacks are discarded, while still capturing coordinates acquired before submission.'
services:
  - webapp
techStack:
  - typescript
  - angular
  - karma
tags:
  - geolocation
  - gps
  - form-submission
  - telemetry
  - timeout
related_workflows:
  - form-submission
  - observability
source_pr: medic/cht-core#11023
source_sha: b8575e8204e79d7a2d72eea6489f8c28471f538c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/geolocation.service.ts
concepts:
  - deferred promise pattern
  - non-blocking form submission
  - late-callback discarding via nulled reference
  - telemetry failure codes
  - GPS watcher lifecycle
related_issues: []
stale: false
---

## Problem

When GPS signal was weak and coordinates had not yet been acquired by the time a user submitted a form, the geolocation service blocked submission for up to 30 seconds while waiting for the GPS watcher to succeed or hit its timeout. This frustrated users on short forms and pushed some deployments to turn GPS off completely.

## Root Cause

complete() (invoked during form save) awaited this.deferred, which only resolved when the GPS watcher fired a success or failure callback — and the failure path included a 30s timeout (code -2). With no fix yet acquired, the promise stayed pending until the watcher resolved, so the save UI hung for the full timeout window.

## Solution

complete() now resolves immediately with {code: -1, message: 'Geolocation not yet acquired'} when no geolocation data is available, instead of awaiting the watcher. Coordinates already acquired while the user filled the form are still captured as before. After complete() resolves, this.deferred is set to null so any late GPS success/failure callbacks are silently discarded and do not leak extra telemetry entries or retroactively mutate the saved doc.

## Code Patterns

Null the deferred reference (this.deferred = null) after resolving so async watcher callbacks that fire later check for it and no-op — a guard pattern to discard stale callbacks. Resolve with a sentinel result ({code: -1}) for the not-yet-acquired state rather than blocking on a pending watcher. See webapp/src/ts/services/geolocation.service.ts.

## Design Choices

Chose to prioritize form-submission UX over guaranteed geolocation capture: resolve instantly with a sentinel -1 code instead of waiting out the 30s -2 timeout. Late callbacks are discarded rather than allowed to populate the doc after save, keeping the saved data and telemetry consistent. The resulting telemetry shift (failures now report -1 instead of -2 for quick submits) was explicitly disclosed so deployments can update alerting/dashboards keyed on -2.

## Related Files

- webapp/src/ts/services/geolocation.service.ts
- webapp/tests/karma/ts/services/geolocation.service.spec.ts

## Testing

Karma unit tests in geolocation.service.spec.ts cover 'submit before any data is acquired' and 'data acquired before submit'. A late-callback test asserts that success/failure callbacks firing after complete() are silently discarded. Note: removing the old 'should resolve promise even if watcher never calls any callback' test leaves the 30s -2 timeout path without a direct isolated test, relying on the remaining timeout test for coverage.

## Related Issues

- #10679: Geolocation service blocks form submission for up to 30s while trying to acquire GPS coordinates on weak signal

## Domain Rationale

**Fit:** weak

The change lives entirely in geolocation.service.ts; it affects the form save lifecycle only as a consumer, so forms-and-reports is the least-bad home rather than a principled fit.

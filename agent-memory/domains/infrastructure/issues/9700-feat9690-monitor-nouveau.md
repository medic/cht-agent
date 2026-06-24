---
id: cht-core-9700
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 9700
issueUrl: https://github.com/medic/cht-core/issues/9700
title: Expose Nouveau full-text search metrics via the /api/v2/monitoring observability endpoint
lastUpdated: '2026-06-22'
summary: The monitoring API exposed health metrics for components like CouchDB and Sentinel but had no visibility into the Nouveau search engine. This PR extends the monitoring service to collect and report Nouveau metrics so operators can observe its state.
services:
  - api
techStack:
  - nodejs
  - javascript
  - couchdb
  - nouveau
  - lucene
tags:
  - monitoring
  - observability
  - nouveau
  - metrics
  - health-check
  - search
related_workflows:
  - observability
  - nouveau-search
source_pr: medic/cht-core#9700
source_sha: db53828bb59759802e3d2408bd4198c226312046
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/monitoring.js
concepts:
  - observability endpoint
  - metrics collection
  - operational health monitoring
  - full-text search index health
related_issues: []
stale: false
---

## Problem

The /api/v2/monitoring endpoint, which operators and monitoring systems scrape to observe instance health, reported no metrics about the Nouveau full-text search engine. Operators therefore had no visibility into Nouveau's state through the standard observability surface.

## Root Cause

The monitoring service (api/src/services/monitoring.js) aggregated metrics only for existing components and contained no logic to query and surface Nouveau search-index metrics in the monitoring response payload.

## Solution

Extended the monitoring service to collect Nouveau metrics and merge them into the aggregated /api/v2/monitoring response, alongside the existing component metrics. Added unit tests and integration tests covering the new Nouveau monitoring output, plus a supporting helper in the shared test utils.

## Code Patterns

Extend the metrics aggregation in api/src/services/monitoring.js by adding a dedicated collector for a component and merging its result into the single monitoring response object; back it with unit tests in api/tests/mocha/services/monitoring.spec.js and integration tests in tests/integration/api/controllers/monitoring.spec.js, using a shared helper added to tests/utils/index.js.

## Design Choices

Surface Nouveau metrics through the existing unified /api/v2/monitoring endpoint rather than introducing a separate endpoint, keeping all operational observability for the instance in one scrapeable place consistent with how other components are reported.

## Related Files

- api/src/services/monitoring.js
- api/tests/mocha/services/monitoring.spec.js
- tests/integration/api/controllers/monitoring.spec.js
- tests/utils/index.js

## Testing

Added unit tests in api/tests/mocha/services/monitoring.spec.js asserting the Nouveau metrics appear in the monitoring service output, and integration tests in tests/integration/api/controllers/monitoring.spec.js validating the metrics over the live /api/v2/monitoring endpoint; tests/utils/index.js gained a supporting test helper.

## Related Issues

- #9690: monitor nouveau — add Nouveau search-engine metrics to the monitoring endpoint

## Domain Rationale

**Fit:** strong

The change extends the /api/v2/monitoring observability endpoint to report Nouveau search-engine metrics — operational tooling for observing the health of the running system, not application behavior. This squarely fits infrastructure under the operational-lifecycle/observability framing (the endpoint exists specifically to be scraped by monitoring systems and used as a health check), rather than the Nouveau index internals that would belong in data-sync.

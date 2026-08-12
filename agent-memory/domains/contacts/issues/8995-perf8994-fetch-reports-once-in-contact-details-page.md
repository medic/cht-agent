---
id: cht-core-8994
category: improvement
domain: contacts
domainFit: strong
issueNumber: 8994
issueUrl: https://github.com/medic/cht-core/issues/8994
title: Fetch reports once in contact details page by passing already-loaded docs (not IDs) to the data-records service
lastUpdated: '2026-08-11'
summary: The contact details page fetched report docs more than once — loading them and then re-fetching inside addHeading. The PR threads already-fetched docs through the view-model generator and summary services, eliminating the redundant fetch.
services:
  - webapp
techStack:
  - typescript
  - angular
  - pouchdb
tags:
  - performance
  - contact-details
  - reports
  - refactor
  - lodash-removal
  - view-model
  - fetch-deduplication
related_workflows: []
source_pr: medic/cht-core#8995
source_sha: 0ba3adb75d0588698ac30c37343eb45c7e2d2038
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts.component.ts
  - webapp/src/ts/services/contact-view-model-generator.service.ts
  - webapp/src/ts/services/get-data-records.service.ts
  - webapp/src/ts/services/get-summaries.service.ts
  - webapp/src/ts/services/target-aggregates.service.ts
concepts:
  - view-model generation
  - fetch deduplication
  - passing docs instead of ids to avoid refetch
  - service API normalization
  - summary generation
related_issues: []
stale: false
---

## Problem

Rendering a contact's details page triggered redundant database reads: report docs were already loaded and handed to addHeading, but addHeading discarded them, mapped them back to IDs and fetched the same docs a second time, slowing page load.

## Root Cause

contactViewModelGenerator.addHeading already received the loaded report docs but discarded them, mapping them to their `_id` values (`_map(reports, '_id')`) and re-fetching summaries through getDataRecordsService.get(ids) rather than reusing docs that had already been loaded; getDataRecordsService.get() also had an inconsistent (id-or-array) signature that encouraged extra round-trips.

## Solution

Changed addHeading to hand its already-loaded report docs to a new getDataRecordsService.getDocsSummaries(docs) instead of mapping them to IDs and calling get(ids), so no second fetch occurs (addHeading's own signature is unchanged); added getDataRecordsService.getDocsSummaries to build summaries from already-fetched records; normalized getDataRecordsService.get() to take only an array of IDs and always return an array; added getSummariesService.getByDocs to attach summary fields from a list of docs; removed lodash from GetDataRecordsService in favor of native Array methods.

## Code Patterns

Pass already-fetched documents downstream instead of IDs to avoid redundant DB round-trips (e.g., getDocsSummaries(docs) rather than get(ids)) — see addHeading in contact-view-model-generator.service.ts. Normalize service method signatures to consistently accept arrays and return arrays (get-data-records.service.ts get()/getDocsSummaries). Add a *-by-docs variant (getSummariesService.getByDocs) that operates on in-memory docs rather than re-querying by id.

## Design Choices

Threading docs through function signatures trades a slightly heavier API surface for the elimination of a duplicate fetch on the hot contact-details path. Normalizing get() to array-in/array-out removes branching and makes callers predictable; dropping lodash for native Array APIs trims a dependency without behavior change.

## Related Files

- webapp/src/ts/modules/contacts/contacts.component.ts
- webapp/src/ts/services/contact-view-model-generator.service.ts
- webapp/src/ts/services/get-data-records.service.ts
- webapp/src/ts/services/get-summaries.service.ts
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/tests/karma/ts/modules/contacts/contacts.component.spec.ts
- webapp/tests/karma/ts/services/contact-view-model-generator.service.spec.ts
- webapp/tests/karma/ts/services/get-data-records.service.spec.ts
- webapp/tests/karma/ts/services/target-aggregates.service.spec.ts

## Testing

Updated Karma unit tests for the affected units: contacts.component, contact-view-model-generator.service, get-data-records.service, and target-aggregates.service specs were modified to cover the new doc-based paths (addHeading delegating to getDocsSummaries, and getDocsSummaries/getByDocs themselves) and the normalized array-only get() API.

## Related Issues

- #8994: performance issue — reports fetched more than once on the contact details page

## Domain Rationale

**Fit:** strong

The change optimizes how the contact details page builds its view model, centered on contacts.component and the contact-view-model-generator service. Although it fetches report docs, the controlling context and primary code are the contacts profile page, not report submission/validation — so contacts is the most specific fit.

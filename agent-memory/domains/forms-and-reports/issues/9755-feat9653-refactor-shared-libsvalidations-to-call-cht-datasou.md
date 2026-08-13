---
id: cht-core-9653
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 9653
issueUrl: https://github.com/medic/cht-core/issues/9653
title: Refactor shared-libs/validation to query cht-datasource for uniqueness/existence checks instead of building reports_by_freetext view queries directly
lastUpdated: '2026-08-13'
summary: The validation library built and executed medic-client/reports_by_freetext queries directly for its uniqueness/existence validators; this refactor routes every such lookup through cht-datasource (Report.v1.getUuids with Qualifier.byFreetext) and initialises the lib with a data context so it can reach that layer.
services:
  - webapp
  - sentinel
techStack:
  - typescript
  - javascript
  - couchdb
  - angular
tags:
  - validation
  - cht-datasource
  - freetext-index
  - refactor
  - shared-libs
  - data-context
related_workflows:
  - form-submission
  - nouveau-search
source_pr: medic/cht-core#9755
source_sha: e4d7bdc807df156e2e467a25b73fc68a7b7173f9
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/validation/src/validation.js
  - shared-libs/validation/src/validation_utils.js
  - shared-libs/transitions/src/transitions/utils.js
  - webapp/src/ts/services/validation.service.ts
  - webapp/src/ts/services/cht-datasource.service.ts
concepts:
  - data-access layer abstraction
  - freetext/search index querying
  - field uniqueness validation
  - data context injection
  - shared library refactoring
related_issues: []
stale: false
---

## Problem

The shared-libs/validation library queried the medic-client/reports_by_freetext view index directly to perform uniqueness/existence validations during form/report and registration processing. That index is being retired, and the direct query bypassed the platform-wide cht-datasource data-access layer, duplicating query logic and diverging from the broader migration to cht-datasource.

## Root Cause

Validators in shared-libs/validation constructed reports_by_freetext queries themselves rather than delegating to cht-datasource's higher-level lookup APIs, and the validation lib was not initialized with a data context, so it had no handle through which to reach cht-datasource.

## Solution

Rewrote the `exists` lookup in validation_utils.js to go through cht-datasource unconditionally: it binds Report.v1.getUuids to the injected data context and drains the returned generator for Qualifier.byFreetext(searchString). No reports_by_freetext query remains in the validation lib. To supply the handle, validation.js's init now forwards options.dataContext into validationUtils.init(db, dataContext); the webapp passes chtDatasourceService.getDataContext() from validation.service.ts, and sentinel passes its own data-context module from shared-libs/transitions/src/transitions/utils.js. (The work reached master via the #9625 epic squash, which carries this same file set.)

## Code Patterns

Inject a data context into a shared library at init time so the lib can reach cht-datasource (see webapp/src/ts/services/validation.service.ts and cht-datasource.service.ts, and shared-libs/transitions/src/transitions/utils.js for the sentinel side), then express lookups as qualifiers — Qualifier.byFreetext(...) against Report.v1.getUuids — rather than as view names and key ranges. Consuming the result means draining an async generator, not reading a rows array.

## Design Choices

Pushed the index-shape decision down into cht-datasource so future changes to the freetext indexes are invisible to the validation lib — the stated goal of #9653. Callers therefore no longer choose a view or a key range: cht-datasource decides internally which index a qualifier hits. On master it uses Nouveau when running server side (no `_design/medic-offline-freetext` ddoc in the db, per `useNouveauIndexes` in src/local/libs/nouveau.ts) and the offline `reports_by_freetext` view otherwise, doing a keyed lookup when the freetext contains a `:` separator (`isKeyedFreetextQualifier`, src/qualifier.ts) and a prefix range scan when it does not. At this draft's anchor Nouveau was not in this path at all — `getUuidsPage` queried `medic-client/reports_by_freetext`, with `:` selecting keyed vs range; Nouveau replaced the views later, in f1bdfc07c (feat(#9542), PR #10201). Delegating rather than rewriting the validators kept backwards compatibility with existing data and configuration.

## Related Files

- shared-libs/transitions/src/transitions/utils.js
- shared-libs/validation/src/validation.js
- shared-libs/validation/src/validation_utils.js
- shared-libs/validation/test/validations.js
- tests/integration/sentinel/transitions/registration.spec.js
- webapp/src/ts/services/cht-datasource.service.ts
- webapp/src/ts/services/validation.service.ts
- webapp/tests/karma/ts/services/validation.service.spec.ts

## Testing

Updated unit tests for the validation library (shared-libs/validation/test/validations.js) and the webapp validation service (webapp/tests/karma/ts/services/validation.service.spec.ts), plus the sentinel transitions registration integration test (tests/integration/sentinel/transitions/registration.spec.js), to cover the new cht-datasource path — stubbing the bound Report.v1.getUuids generator in place of the old view query, and asserting that the data context is threaded through init.

## Related Issues

- #9653: refactor shared-libs/validations to call cht-datasource instead of directly querying the medic-client/reports_by_freetext index, which is going away
- #9586: the cht-datasource freetext search API this refactor consumes

## Domain Rationale

**Fit:** strong

shared-libs/validation provides the field-validation rules (uniqueness, existence) that gate form submission and report/registration processing, so it sits squarely in forms-and-reports; the change is a data-access refactor (cht-datasource) underneath that validation logic, which keeps the fit strong though adjacent to data-sync.

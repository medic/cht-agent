---
id: cht-core-9755
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 9755
issueUrl: https://github.com/medic/cht-core/issues/9755
title: Refactor shared-libs/validation to query cht-datasource for uniqueness/existence checks, falling back to freetext index only for whitespace search strings
lastUpdated: '2026-06-22'
summary: The validation library queried CouchDB freetext indexes directly for uniqueness/existence validators; this refactor routes those lookups through the unified cht-datasource layer where possible and only falls back to the freetext index when the search string contains whitespace.
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

The shared-libs/validation library built and executed CouchDB freetext index queries directly to perform uniqueness/existence validations during form/report and registration processing. This bypassed the platform-wide cht-datasource data-access layer, duplicating query logic and diverging from the broader migration to cht-datasource.

## Root Cause

Validators in shared-libs/validation depended on direct freetext index query construction rather than delegating to cht-datasource's higher-level lookup APIs, and the validation lib was not initialized with a data context to reach cht-datasource.

## Solution

Refactored the validation library to query cht-datasource where possible (exact lookups) while still querying freetext indexes when the search string contains whitespace, which cht-datasource lookups can't satisfy. The webapp validation.service was updated to pass the cht-datasource data context when initializing the validations lib, with corresponding adjustments to shared-libs/transitions/src/transitions/utils.js.

## Code Patterns

Route data access through cht-datasource with a freetext-index fallback for whitespace-containing search terms; inject a data context into a shared library at init time so the lib can reach cht-datasource (see webapp/src/ts/services/validation.service.ts and cht-datasource.service.ts).

## Design Choices

Retained direct freetext index querying as a fallback because cht-datasource lookups do not support multi-term/whitespace freetext searches; chose an incremental delegation to cht-datasource over a full rewrite to preserve backwards compatibility with existing data and configuration.

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

Updated unit tests for the validation library (shared-libs/validation/test/validations.js) and the webapp validation service (webapp/tests/karma/ts/services/validation.service.spec.ts), plus the sentinel transitions registration integration test (tests/integration/sentinel/transitions/registration.spec.js), to cover the new cht-datasource path and the freetext-index fallback for whitespace searches.

## Related Issues

- #9653: refactor shared-libs/validations to call cht-datasource instead of directly querying freetext index

## Domain Rationale

**Fit:** strong

shared-libs/validation provides the field-validation rules (uniqueness, existence) that gate form submission and report/registration processing, so it sits squarely in forms-and-reports; the change is a data-access refactor (cht-datasource) underneath that validation logic, which keeps the fit strong though adjacent to data-sync.

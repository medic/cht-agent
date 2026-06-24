---
id: cht-core-10081
category: improvement
domain: contacts
domainFit: strong
issueNumber: 10081
issueUrl: https://github.com/medic/cht-core/issues/10081
title: Remove lineage checks from cht-datasource person data source and qualifier
lastUpdated: '2026-06-22'
summary: 'The cht-datasource person module and qualifier performed lineage validation checks that were deemed unnecessary during review of PR #10043. This PR removes those checks and updates the associated unit and integration tests.'
services:
  - api
techStack:
  - typescript
  - javascript
  - couchdb
tags:
  - lineage
  - person
  - cht-datasource
  - qualifier
  - contact-hierarchy
related_workflows: []
source_pr: medic/cht-core#10081
source_sha: 0ab6f8bab6656c553641a0d4115e2b1e7a831ee3
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - contact lineage
  - data source abstraction
  - qualifiers
  - person retrieval
related_issues: []
stale: false
---

## Problem

The cht-datasource person retrieval path (local person data source and qualifier) enforced lineage checks/validation that were redundant or overly restrictive, as identified in the review discussion on PR #10043. These checks added complexity and constrained how persons could be resolved.

## Root Cause

The local person data source and qualifier logic in cht-datasource included explicit lineage validation that was not actually required for correct person retrieval, surfaced during code review of the related person/lineage work in PR #10043.

## Solution

Removed the lineage checks from shared-libs/cht-datasource/src/local/person.ts and adjusted shared-libs/cht-datasource/src/qualifier.ts accordingly, simplifying person retrieval. Unit tests (cht-datasource local/person, person, qualifier, remote/person specs), the api mocha person controller test, and the api/cht-datasource integration tests were updated to reflect the removed checks.

## Code Patterns

Qualifier-based data access in cht-datasource (shared-libs/cht-datasource/src/qualifier.ts) and the local/remote data source abstraction for persons (shared-libs/cht-datasource/src/local/person.ts).

## Design Choices

Per the review discussion on PR #10043 (comment r2140370176), the lineage checks were removed rather than reworked because they were not necessary for correct person retrieval; dropping them simplifies the datasource and avoids unneeded validation.

## Related Files

- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/test/local/person.spec.ts
- shared-libs/cht-datasource/test/person.spec.ts
- shared-libs/cht-datasource/test/qualifier.spec.ts
- shared-libs/cht-datasource/test/remote/person.spec.ts
- api/tests/mocha/controllers/person.spec.js
- tests/integration/api/controllers/person.spec.js
- tests/integration/shared-libs/cht-datasource/person.spec.js

## Testing

Tested checkbox marked. Updated cht-datasource unit tests (local/person.spec.ts, person.spec.ts, qualifier.spec.ts, remote/person.spec.ts), the api mocha person controller spec, and integration tests for both the api person controller and the cht-datasource person module to align with the removed lineage checks.

## Related Issues

- #9835: parent issue tracking the cht-datasource person/lineage work this change implements
- #10043: related PR whose review discussion (comment r2140370176) prompted removing the lineage checks

## Domain Rationale

**Fit:** strong

The PR changes the cht-datasource `person` module and `qualifier`, which handle person (contact) retrieval and the contact lineage (hierarchy). Persons are contacts and lineage is the contact-hierarchy chain, so this squarely belongs to the contacts domain rather than the data-layer/sync bucket.

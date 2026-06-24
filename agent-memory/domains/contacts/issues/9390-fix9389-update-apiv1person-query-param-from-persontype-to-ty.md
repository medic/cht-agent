---
id: cht-core-9389
category: improvement
domain: contacts
domainFit: strong
issueNumber: 9389
issueUrl: https://github.com/medic/cht-core/issues/9389
title: Rename api/v1/person query parameter from personType to type for snake_case API consistency
lastUpdated: '2026-06-23'
summary: A recently added (still unreleased) get-persons-by-type capability on the GET /api/v1/person endpoint exposed its filter as the camelCase query parameter `personType`, violating CHT's REST API convention. The PR renames the parameter to `type` across the controller, the cht-datasource remote module, and the tests.
services:
  - api
techStack:
  - javascript
  - typescript
  - nodejs
  - express
tags:
  - rest-api
  - query-parameter
  - api-convention
  - snake-case
  - person
  - naming
  - cht-datasource
related_workflows: []
source_pr: medic/cht-core#9390
source_sha: d66140cf9aad795f187b461102188fcf9a98d820
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/person.js
  - shared-libs/cht-datasource/src/remote/person.ts
concepts:
  - REST API query-parameter naming convention
  - person/contact data access
  - API consistency
  - pre-release breaking-change avoidance
related_issues: []
stale: false
---

## Problem

The newly added support for fetching persons by type on GET /api/v1/person (introduced in PR #9311) read its filter from a camelCase `personType` query parameter. This breaks CHT's REST API convention that query parameter names are snake_case rather than camel-case, and the inconsistency was missed during the original code review.

## Root Cause

In PR #9311 the person-by-type filter was wired to a `personType` query parameter in the api person controller and mirrored in the cht-datasource remote person module, instead of following the established snake_case (lowercase) query-parameter convention used elsewhere in the API.

## Solution

Renamed the query parameter from `personType` to `type` in `api/src/controllers/person.js` (where `req.query` is read) and in `shared-libs/cht-datasource/src/remote/person.ts` (where the request params are built), then updated the unit, datasource, and integration tests to match. Because the feature was unreleased, the rename ships with no migration and no breaking-change impact on existing clients.

## Code Patterns

CHT REST API query-parameter names should be snake_case / simple lowercase, not camelCase — read the filter as `type` from `req.query` in api controllers and set the same key when constructing request params in cht-datasource remote modules (api/src/controllers/person.js, shared-libs/cht-datasource/src/remote/person.ts). Keep the api controller and the cht-datasource remote client in lockstep on parameter names.

## Design Choices

Chose `type` over `person_type` or keeping `personType` because the endpoint path (/api/v1/person) already implies the entity, so the parameter only needs to convey the discriminator. Doing the rename before the feature was released avoided any deprecation/aliasing or migration that an already-shipped parameter would have required.

## Related Files

- api/src/controllers/person.js
- api/tests/mocha/controllers/person.spec.js
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/test/remote/person.spec.ts
- tests/integration/api/controllers/person.spec.js

## Testing

Updated the mocha unit tests for the controller (api/tests/mocha/controllers/person.spec.js), the cht-datasource remote person tests (shared-libs/cht-datasource/test/remote/person.spec.ts), and the API integration tests (tests/integration/api/controllers/person.spec.js) to exercise and assert the new `type` query parameter instead of `personType`.

## Related Issues

- #9389: api/v1/person query param should be `type`, not camelCase `personType`, to follow the snake_case REST API convention
- #9311: original PR that added get-persons-by-type support and introduced the inconsistent `personType` parameter

## Domain Rationale

**Fit:** strong

The endpoint and the changed `cht-datasource` module are the person data-access layer, and persons are a type of CHT contact — this is squarely contact lookup (retrieving persons by type), even though it is delivered over the REST API surface.

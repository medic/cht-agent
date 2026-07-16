---
id: cht-core-10036
category: feature
domain: contacts
domainFit: strong
issueNumber: 10036
issueUrl: https://github.com/medic/cht-core/issues/10036
title: Add API support for createPerson via the cht-datasource person concept module
lastUpdated: '2026-06-22'
summary: There was no unified, programmatic way to create a person (contact) through the cht-datasource interface or the API. This PR adds a createPerson function to the person concept module with qualifier and parameter-validation support, exposes it through the remote implementation and the public datasource index, and wires up a new API controller and route.
services:
  - api
techStack:
  - typescript
  - javascript
  - nodejs
tags:
  - cht-datasource
  - createPerson
  - person
  - contacts
  - api
  - concept-module
  - data-access-layer
related_workflows:
  - contact-creation
source_pr: medic/cht-core#10061
source_sha: 579281d3de3bbcfa68f201d6e9f28f88f4880d1c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/index.ts
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/qualifier.ts
  - shared-libs/cht-datasource/src/libs/parameter-validators.ts
  - api/src/controllers/person.js
  - api/src/routing.js
concepts:
  - cht-datasource concept module
  - unified data-access interface
  - datasource abstraction layer
  - qualifiers and parameter validation
  - API controller and routing
related_issues: []
stale: false
---

## Problem

The cht-datasource library only exposed read/get operations for persons; there was no createPerson function in the person concept module and no API route to programmatically create a person contact through the unified datasource interface.

## Root Cause

Architectural gap rather than a bug: the person concept module, its remote implementation, qualifiers, parameter validators, and the public src/index.ts exports lacked any create/mutation path, and the API had no person creation controller or route.

## Solution

Added a createPerson function to the person concept module (src/person.ts) with supporting qualifier (src/qualifier.ts) and parameter validation (src/libs/parameter-validators.ts), implemented the remote variant (src/remote/person.ts), exported it from the datasource entry point (src/index.ts), and added an API controller (api/src/controllers/person.js) plus a new route in api/src/routing.js to invoke it over HTTP.

## Code Patterns

Follows the cht-datasource concept-module layering: each entity (person, and later place/report) gets a concept module (src/person.ts) exposing a unified interface, a remote implementation (src/remote/person.ts), shared qualifiers (src/qualifier.ts) and parameter validators (src/libs/parameter-validators.ts), and a public export via src/index.ts; the API then thinly wraps the datasource in a controller (api/src/controllers/person.js) registered in api/src/routing.js. New mutations for other entities should replicate this same pattern.

## Design Choices

Implemented createPerson inside the existing cht-datasource concept-module architecture rather than as a one-off API handler, keeping a single unified interface shared across local and remote consumers and making the pattern reusable for upcoming places and reports work. Per reviewer feedback, the PR is intentionally scoped to the datasource and API support plus unit tests, deferring integration and e2e tests to a follow-up PR.

## Related Files

- api/src/controllers/person.js
- api/src/routing.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/test/index.spec.ts
- shared-libs/cht-datasource/test/person.spec.ts
- shared-libs/cht-datasource/test/qualifier.spec.ts
- shared-libs/cht-datasource/test/remote/person.spec.ts

## Testing

Unit tests added/updated across the cht-datasource layer: person.spec.ts, qualifier.spec.ts, index.spec.ts, and remote/person.spec.ts cover the new createPerson interface, qualifier, and parameter validation. Reviewer explicitly requested API mocha tests (api/tests/mocha/controllers/person.spec.js) and integration/e2e tests (tests/integration/api/controllers/person.spec.js) be delivered in a separate follow-up PR.

## Related Issues

- #10036: Expose a unified interface for person interaction (createPerson) via the relevant top-level cht-datasource concept module

## Domain Rationale

**Fit:** strong

A 'person' is a core contact type in CHT's data model, so adding a unified createPerson interface and API endpoint is directly about contact creation and management. The datasource/library plumbing is incidental to the contact-domain behavior being exposed.

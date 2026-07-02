---
id: cht-core-10124
category: feature
domain: contacts
domainFit: strong
issueNumber: 10124
issueUrl: https://github.com/medic/cht-core/issues/10124
title: Store person/place (and report) parent/contact fields as a dehydrated lineage object instead of a bare string id
lastUpdated: '2026-06-22'
summary: When creating persons/places/reports through cht-datasource, the parent and contact fields were persisted as plain string IDs. This PR fetches and validates the referenced parent (ensuring its contact_type is one of the allowed parents for the new contact's type) and stores the parent/contact field as a dehydrated (minified) lineage object instead.
services:
  - api
techStack:
  - typescript
  - javascript
  - couchdb
tags:
  - dehydrated-lineage
  - contact-hierarchy
  - parent-validation
  - cht-datasource
  - person
  - place
  - report
related_workflows:
  - contact-creation
  - form-submission
source_pr: medic/cht-core#10124
source_sha: 95153376d55a91f57cbd9b6c7a6248a70d39025d
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/input.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/local/place.ts
  - shared-libs/cht-datasource/src/local/report.ts
concepts:
  - dehydrated/minified lineage
  - contact hierarchy
  - contact-type allowed-parents validation
  - cht-datasource local vs remote data source
related_issues: []
stale: false
---

## Problem

Creating person/place (and report) documents via cht-datasource stored the `parent` and `contact` fields as plain string IDs. The persisted contact docs therefore lacked the dehydrated (minified) nested lineage structure the rest of CHT relies on for hierarchy traversal, and the parent was not validated against the contact type's configured allowed parents.

## Root Cause

The create/input path in cht-datasource (input.ts and the local/person.ts, local/place.ts, local/report.ts handlers) only wrote the parent/contact id string — it never fetched the referenced parent contact, never checked its contact_type, and never constructed the nested lineage object.

## Solution

On create, fetch the referenced parent contact, validate that its contact_type is among the allowed `parents` configured for the new contact's contact_type, and then store the `parent` (and `contact`) field as a dehydrated/minified lineage object (nested `{_id, parent: {_id, parent: ...}}`) rather than a string. The same lineage-storage approach is applied to person, place, and report creation; place/report `contact` storage needs no parent-type validation.

## Code Patterns

Centralized parent fetch + contact_type-vs-allowed-parents validation and dehydrated-lineage construction in shared-libs/cht-datasource/src/input.ts, reused by local/person.ts, local/place.ts, and local/report.ts so person/place/report creation share one lineage-storage path.

## Design Choices

Persist the minified/dehydrated lineage (nested id chain) rather than a bare string id or the full parent documents — this matches how CHT contact docs natively encode hierarchy, enabling offline lineage traversal without extra lookups while keeping document size small. Validating the parent's contact_type against the configured allowed parents prevents construction of invalid hierarchies at write time.

## Related Files

- shared-libs/cht-datasource/src/input.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/test/input.spec.ts
- shared-libs/cht-datasource/test/local/person.spec.ts
- shared-libs/cht-datasource/test/local/place.spec.ts
- shared-libs/cht-datasource/test/local/report.spec.ts
- shared-libs/cht-datasource/test/remote/report.spec.ts
- api/tests/mocha/controllers/report.spec.js
- tests/integration/api/controllers/person.spec.js
- tests/integration/api/controllers/place.spec.js
- tests/integration/api/controllers/report.spec.js
- tests/integration/shared-libs/cht-datasource/person.spec.js
- tests/integration/shared-libs/cht-datasource/place.spec.js
- tests/integration/shared-libs/cht-datasource/report.spec.js

## Testing

Unit tests in shared-libs/cht-datasource/test (input.spec.ts plus local person/place/report specs and remote report spec) and a mocha controller test (api/tests/mocha/controllers/report.spec.js), backed by integration tests under tests/integration for api controllers (person/place/report) and cht-datasource (person/place/report). The PR's 'Tested' checklist item is checked.

## Related Issues

- #10038: store parent/contact with dehydrated lineage instead of a plain string id

## Domain Rationale

**Fit:** strong

The PR changes how person/place (and report) documents store their parent/contact hierarchy during creation in cht-datasource — contact creation and hierarchy/lineage management are core to the contacts domain. The parent-type check reads contact-type config but the change is to contact-creation logic (not configuration itself) and the lineage representation is a contact-document concern rather than sync/replication mechanics, so contacts is a strong fit.

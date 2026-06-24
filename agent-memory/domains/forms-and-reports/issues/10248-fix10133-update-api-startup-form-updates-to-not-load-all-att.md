---
id: cht-core-10133
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 10133
issueUrl: https://github.com/medic/cht-core/issues/10133
title: Load only business-logic form attachments (form.xml, model.xml, form.html) on API startup and form update, avoiding CouchDB large-attachment timeouts
lastUpdated: '2026-06-22'
summary: On startup and on form change the API read the entire form document including all (potentially large media) attachments, causing needless server load and tripping a CouchDB _all_docs large-attachment timeout bug. It was changed to read and save only the form.xml, model.xml, and form.html attachments that have business-logic value for XForm generation.
services:
  - api
techStack:
  - javascript
  - node.js
  - couchdb
  - pouchdb
  - enketo
  - xforms
tags:
  - form-attachments
  - attachment-loading
  - xform-generation
  - performance
  - couchdb-timeout
related_workflows: []
source_pr: medic/cht-core#10248
source_sha: e0c5407a90763ab5c3619cfb7b487d85f6bae75d
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/forms.js
  - api/src/services/generate-xform.js
concepts:
  - selective attachment loading
  - XForm generation/transformation
  - CouchDB attachment retrieval via getAttachment
  - avoiding _all_docs reads of large attachments
  - form document processing on startup and change
related_issues: []
stale: false
---

## Problem

When CHT-API loaded forms on startup or processed a form update, it read the full form document including every attachment — including large media attachments unrelated to the form definition. This placed unnecessary load on the server and triggered a long-standing CouchDB bug (apache/couchdb#2210) where reading very large attachments through an _all_docs call times out, making the operation expensive, slow, and at times failing outright.

## Root Cause

generate-xform.js (around lines 260/276) and forms.js fetched complete form documents with all attachments embedded (e.g. via _all_docs / full-doc reads) rather than retrieving only the attachments needed for business logic. Media attachments were thus pulled even when only the XML/HTML form-definition attachments were required, and large attachments via _all_docs hit the CouchDB timeout.

## Solution

Reworked how forms are loaded on startup and on change so that only the attachments with business-logic value — form.xml, model.xml, and form.html — are read and saved. Instead of reading the whole document with all attachments, the relevant attachments are fetched selectively by name (via PouchDB getAttachment) so large media attachments are never loaded during XForm generation/processing.

## Code Patterns

Fetch specific attachments by name with medic.getAttachment() instead of pulling all attachments in a bulk/full-doc read; restrict form processing to the known business-logic attachment set (form.xml, model.xml, form.html) in api/src/services/generate-xform.js and api/src/services/forms.js.

## Design Choices

Selective per-attachment fetching avoids the CouchDB _all_docs large-attachment timeout (apache/couchdb#2210) and cuts server load, trading a few extra targeted attachment requests for not transferring potentially huge media blobs — a clear win since only small XML/HTML attachments are needed for XForm generation.

## Related Files

- api/src/services/forms.js
- api/src/services/generate-xform.js
- api/tests/mocha/controllers/forms.spec.js
- api/tests/mocha/services/forms.spec.js
- api/tests/mocha/services/generate-xform.spec.js

## Testing

Updated mocha unit tests for the affected services and controller (generate-xform.spec.js, forms.spec.js, controllers/forms.spec.js). Review iterations surfaced failing tests because the new code calls PouchDB's medic.getAttachment() directly, which had to be stubbed in the unit-test environment (UNIT_TEST_ENV=1) to satisfy the 'PouchDB functions must be stubbed' assertion.

## Related Issues

- #10133: CouchDB times out when very large form attachments are read through an _all_docs call; avoid loading all attachments on startup
- #10132: API reads the full form document including all attachments on form update, which is expensive and pointless when only XML attachments changed

## Domain Rationale

**Fit:** strong

The change lives entirely in the API's form-processing services (forms.js, generate-xform.js) and encodes form-specific business logic about which attachments matter for XForm generation. It is not client/server replication (data-sync) and not operational lifecycle (infrastructure), so forms-and-reports is the squarely correct functional domain.

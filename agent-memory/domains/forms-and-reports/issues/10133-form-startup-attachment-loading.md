---
id: cht-core-10133
category: bug
domain: forms-and-reports
subDomain: api
issueNumber: 10133
issueUrl: https://github.com/medic/cht-core/issues/10133
title: API startup loads all form attachments unnecessarily via _all_docs
lastUpdated: '2026-07-16'
source_prs:
  - "medic/cht-core#10248"
related_issues:
  - cht-core-10132
summary: During API startup, form processing loaded all attachments (including large media files) in a single _all_docs call, causing timeouts on instances with large form media. Fixed by loading attachments separately and only fetching relevant ones.
services:
  - api
techStack:
  - javascript
  - couchdb
---

## Problem

When the API server started, it processed all forms by loading them via a CouchDB `_all_docs` call that included all attachments. On instances with forms containing large media files (images, audio), this call could time out due to a known CouchDB bug where `_all_docs` with large attachments hangs. The same full-document read also happened on form update, making it expensive even when only XML attachments changed (#10132).

## Root Cause

The `generate-xform.js` service used a single `_all_docs` request with `attachments=true` to fetch all form documents at once. CouchDB has a longstanding issue (apache/couchdb#2210) where reading very large attachments through `_all_docs` causes timeouts. The code did not need all attachments for the XForm generation step, only specific XML-related ones. The full-doc reads occurred around generate-xform.js lines 260/276 (PR #10248).

## Solution

Updated the form loading code in `generate-xform.js` to not request attachments in the `_all_docs` call. Instead, attachments are loaded separately per form, and only the relevant ones are fetched. Specifically, only the business-logic attachments needed for XForm generation — `form.xml`, `model.xml`, and `form.html` — are read and saved; large media attachments are never loaded during startup or form processing (PR #10248). PR #10248 changed 5 files in the API layer.

## Code Patterns

- Never use `_all_docs` with `attachments=true` when documents may have large binary attachments
- Load attachments separately and selectively, specifying which attachment names you need
- Fetch specific attachments by name with `medic.getAttachment()` rather than pulling all attachments in a bulk/full-doc read, restricting form processing to the known business-logic set `form.xml`, `model.xml`, `form.html` (PR #10248)
- File: `api/src/services/generate-xform.js` handles form XML generation at startup
- File: `api/src/services/forms.js` manages form document retrieval
- Pattern: when working with CouchDB documents that have attachments, always consider the size implications of bulk reads

## Design Choices

- Chose to load attachments separately per document rather than in batch, accepting the trade-off of more HTTP requests for reliability
- Only loads XML-related attachments needed for XForm generation, skipping media files entirely during startup

## Related Files

- api/src/services/forms.js
- api/src/services/generate-xform.js
- api/tests/mocha/controllers/forms.spec.js
- api/tests/mocha/services/forms.spec.js
- api/tests/mocha/services/generate-xform.spec.js

## Testing

- Updated unit tests for forms service and generate-xform service
- Verified that form processing still works correctly with the separate attachment loading
- Because the new code calls PouchDB's `medic.getAttachment()` directly, it must be stubbed in the unit-test environment (`UNIT_TEST_ENV=1`) to satisfy the "PouchDB functions must be stubbed" assertion (PR #10248)

## Related Issues

- CouchDB upstream: apache/couchdb#2210 (_all_docs timeout with large attachments)
- #10132: API reads the full form document including all attachments on form update, expensive when only XML attachments changed

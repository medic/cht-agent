---
id: cht-core-10133
category: bug
domain: forms-and-reports
subDomain: api
issueNumber: 10133
issueUrl: https://github.com/medic/cht-core/issues/10133
title: API startup loads all form attachments unnecessarily via _all_docs
lastUpdated: '2026-08-09'
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

When the API server started, it processed all forms by loading them via a CouchDB `_all_docs` call that included all attachments. On instances with forms containing large media files (images, audio), this call could time out due to a known CouchDB bug where `_all_docs` with large attachments hangs. An equivalent full-document read happened on the single-form update path too — a separate call in a different file — making that path expensive even when only XML attachments changed (#10132).

## Root Cause

Two separate full-document reads, in two different files. `api/src/services/forms.js` (`getFormDocs`) issued a single `_all_docs` request with `attachments: true, binary: true` to fetch every form document at once — this is the one that hangs, because CouchDB has a longstanding issue (apache/couchdb#2210) where reading very large attachments through `_all_docs` causes timeouts. Separately, `generate-xform.js`'s single-form `update` path did `db.medic.get(docId, { attachments: true, binary: true })`, which is the #10132 half: expensive on every form update even when only XML attachments changed. The issue report points at generate-xform.js (around lines 260 and 276, i.e. `update` and `updateAll`), but `updateAll` only reaches the `_all_docs` call indirectly through `formsService.getFormDocs()`. Neither path needed the media attachments.

## Solution

Dropped `attachments` from both reads: `forms.js`'s `_all_docs` call now passes only `include_docs`, and `generate-xform.js`'s `update` now calls plain `db.medic.get(docId)`. Attachments are then loaded separately, by name, per form. Only the business-logic attachments needed for XForm generation are read and saved: the XForm XML attachment — whose name is resolved dynamically by the new `formsService.getXFormAttachmentName(doc)` helper (literally `xml`, or any `*.xml` other than `model.xml`) — plus `model.xml` and `form.html`. Large media attachments are never loaded during startup or form processing (PR #10248). PR #10248 changed 5 files in the API layer.

## Code Patterns

- Never use `_all_docs` with `attachments=true` when documents may have large binary attachments
- Load attachments separately and selectively, specifying which attachment names you need
- Fetch specific attachments by name with `db.medic.getAttachment()` rather than pulling all attachments in a bulk/full-doc read, restricting form processing to the business-logic set: the XForm XML attachment (name resolved at runtime, not a fixed `form.xml`), plus `model.xml` and `form.html` (PR #10248)
- Resolve an attachment's name through a shared helper (`formsService.getXFormAttachmentName`) instead of hardcoding it — form docs name their XML attachment `xml` or `<something>.xml`, and the e2e replication test asserts exactly the trio `['model.xml', 'form.html', 'xml']`
- File: `api/src/services/forms.js` owns form document retrieval and the `_all_docs` call that was the actual source of the timeout
- File: `api/src/services/generate-xform.js` handles form XML generation at startup and the single-form update read
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
- Because the new code calls PouchDB's `db.medic.getAttachment()` directly, it must be stubbed in the unit-test environment (`UNIT_TEST_ENV=1`) to satisfy the "not stubbed!" assertion in api/src/db.js (PR #10248)

## Related Issues

- CouchDB upstream: apache/couchdb#2210 (_all_docs timeout with large attachments)
- #10132: API reads the full form document including all attachments on form update, expensive when only XML attachments changed

---
id: cht-core-10904
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10904
issueUrl: https://github.com/medic/cht-core/issues/10904
title: Route file/binary attachments to the correct [db-doc="true"] sub-document in Enketo report forms
lastUpdated: '2026-06-22'
summary: Binary/file attachments in report forms were always saved to the main report doc, even when the field belonged to a `[db-doc="true"]` sub-document. This PR walks the XML tree to resolve each attachment's owning sub-doc and routes both FileManager uploads and inline base64 blobs accordingly.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - xml
  - couchdb
tags:
  - file-attachments
  - db-doc
  - sub-documents
  - binary-fields
  - enketo
  - report-forms
  - photo-capture
  - filemanager
related_workflows:
  - form-submission
  - contact-creation
source_pr: medic/cht-core#10922
source_sha: cc34e086640dbfb67f9da42f5806d2701d77fea4
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/enketo.service.ts
  - resolveOwnerDoc
  - findBinaryNodeByFilename
concepts:
  - db-doc sub-document generation in Enketo forms
  - binary attachment routing
  - XML tree ancestor resolution
  - Enketo FileManager file handling
  - inline base64 binary blob extraction
related_issues: []
stale: false
---

## Problem

When a report form contained `[db-doc="true"]` sub-documents with binary/file fields (e.g. photo capture for sub-contacts), every attachment was saved onto the main report doc regardless of which sub-doc the binary field actually belonged to, so sub-document photos/files landed on the wrong document.

## Root Cause

The Enketo service attached all binary/file fields (both FileManager uploads and inline base64 blobs) to the main report doc without inspecting the position of the binary node within the XML tree, so it never identified the nearest `[db-doc="true"]` ancestor that should own the attachment.

## Solution

Added `resolveOwnerDoc()` which walks up the XML tree from a binary node to the nearest `[db-doc="true"]` ancestor and returns the corresponding prepared sub-doc (falling back to the main report doc). Added `findBinaryNodeByFilename()` to locate the `[type=binary]` XML node matching a FileManager filename so its tree position can be used. FileManager-uploaded files and inline base64 binary fields inside sub-docs are now attached to the resolved owner doc instead of unconditionally to the main report.

## Code Patterns

Ownership-by-tree-position: `resolveOwnerDoc()` in webapp/src/ts/services/enketo.service.ts ascends XML parents to the nearest `[db-doc="true"]` node and maps it to its prepared sub-doc, with the main report doc as fallback. `findBinaryNodeByFilename()` bridges FileManager filenames back to their `[type=binary]` XML node so position-based routing works for uploaded files as well as inline blobs.

## Design Choices

Routing by XML node position (ancestor walk) rather than flat filename-to-doc matching ensures attachments land on the structurally-correct owner; falling back to the main report doc preserves backward-compatible behavior for forms without sub-docs. Known limitation flagged in review (dianabarsan): when two sub-docs contain files of the same name (e.g. default-named camera captures), filename-based lookup returns the first match and both files route to the same sub-doc.

## Related Files

- webapp/src/ts/services/enketo.service.ts
- webapp/tests/karma/ts/services/enketo.service.spec.ts
- tests/e2e/default/enketo/submit-db-doc-file-upload.wdio-spec.js
- tests/e2e/default/enketo/forms/db-doc-file-upload.xml
- tests/e2e/default/enketo/forms/db-doc-multi-file-upload.xml
- tests/e2e/default/enketo/forms/db-doc-repeat-file-upload.xml
- webapp/tests/karma/ts/services/enketo-xml/db-doc-with-binary.xml
- webapp/tests/karma/ts/services/enketo-xml/db-doc-with-file-field.xml
- webapp/tests/karma/ts/services/enketo-xml/db-doc-with-file-field-cleared.xml
- webapp/tests/karma/ts/services/enketo-xml/db-doc-orphan-file.xml
- webapp/tests/karma/ts/services/enketo-xml/db-doc-in-repeat-with-files.xml

## Testing

Added Karma unit tests in enketo.service.spec.ts backed by new XML fixtures covering binary-in-sub-doc, file-field, cleared file field, orphan file (no db-doc ancestor → main report fallback), and db-doc-in-repeat-with-files. At reviewer dianabarsan's request, added an end-to-end WDIO spec (submit-db-doc-file-upload.wdio-spec.js) with forms exercising multiple sub-docs, multi-file upload, and sub-docs inside repeats, asserting attachments are saved on the correct documents.

## Related Issues

- #10904: child issue closed by this PR — route file attachments to correct sub-docs
- #10700: parent epic — photo capture for sub contacts
- #10903: sibling issue this work was adapted from

## Domain Rationale

**Fit:** strong

The change lives in the Enketo form-submission service (enketo.service.ts) and governs how report forms with `[db-doc="true"]` sub-documents produce docs and attach binary/file fields. Attachment routing during report-form processing is core forms-and-reports territory; the contact angle (sub-contact photo capture) is only the originating use case, not the mechanism.

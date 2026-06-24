---
id: cht-core-11116
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 11116
issueUrl: https://github.com/medic/cht-core/issues/11116
title: Route Enketo form file attachments to their owning child (db-doc) document instead of attaching all files to the primary doc
lastUpdated: '2026-06-22'
summary: Forms that generate multiple documents via the db-doc pattern attached all uploaded files to a single document, misplacing attachments on child docs. This change routes each binary/file field to the specific db-doc that owns it, correctly handling contact photos, sub-contact attachments, and files inside repeats.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - xforms
  - couchdb
  - less
tags:
  - attachments
  - file-upload
  - db-doc
  - enketo
  - contact-photo
  - binary-fields
  - repeats
related_workflows:
  - form-submission
  - contact-creation
source_pr: medic/cht-core#11116
source_sha: e88c883617d40692f270dd9a5dc8709d8183db50
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/enketo.service.ts
  - webapp/src/ts/services/enketo-translation.service.ts
  - webapp/src/ts/services/form.service.ts
  - webapp/src/ts/services/contact-save.service.ts
  - webapp/src/ts/services/format-data-record.service.ts
  - webapp/src/ts/components/contact-photo/contact-photo.component.ts
concepts:
  - Enketo XForms-to-CouchDB translation
  - db-doc pattern (single form producing multiple documents)
  - CouchDB document attachments
  - per-document attachment routing
  - file fields inside repeats
related_issues: []
stale: false
---

## Problem

The Enketo db-doc pattern lets one form create several documents, but file-upload fields were not associated with the child document they belonged to — all binaries landed on the single primary submitted doc (or were dropped). This broke contact photos and attachments on sub-contacts created through family/household forms, and didn't support files in repeated sections.

## Root Cause

The enketo and enketo-translation services extracted file/binary fields and bound them to the one record being saved, with no logic to map each file field to the particular db-doc within the form's record structure that owned it.

## Solution

Updated enketo.service.ts and enketo-translation.service.ts to detect file/binary fields per generated document and attach each binary to its owning db-doc, including fields inside repeats and handling for cleared/orphaned file fields. contact-save.service.ts, contact-photo.component.ts, and contacts-content.component.ts were updated so contacts and sub-contacts render their correctly-routed photo attachment; format-data-record.service.ts adjusted for the new attachment placement.

## Code Patterns

Per-document attachment routing: when translating an Enketo submission into multiple CouchDB docs, iterate file/binary fields and attach each to the db-doc that contains the field rather than the top-level report (enketo-translation.service.ts, enketo.service.ts). Fixtures db-doc-with-binary.xml, db-doc-orphan-file.xml, db-doc-with-file-field-cleared.xml, and db-doc-in-repeat-with-files.xml model the edge cases.

## Design Choices

Each generated document is made self-contained with its own attachments (files attach to their owning child doc, not the parent report), and the routing explicitly handles files within repeats plus cleared and orphaned file fields so submissions remain consistent.

## Related Files

- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/enketo-translation.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/contact-save.service.ts
- webapp/src/ts/services/format-data-record.service.ts
- webapp/src/ts/components/contact-photo/contact-photo.component.ts
- webapp/src/ts/components/contact-photo/contact-photo.component.html
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/ts/modules/contacts/contacts-content.component.html
- webapp/tests/karma/ts/services/enketo-xml/db-doc-with-binary.xml
- webapp/tests/karma/ts/services/enketo-xml/db-doc-in-repeat-with-files.xml
- tests/e2e/default/contacts/sub-contact-attachments.wdio-spec.js
- tests/e2e/default/enketo/submit-db-doc-file-upload.wdio-spec.js

## Testing

Added e2e wdio specs (contact-attachments, sub-contact-attachments, submit-db-doc-file-upload) with new XForms fixtures for single/multi/repeat db-doc file uploads and family-with-attachments create/edit forms; added/updated karma unit specs for enketo, enketo-translation, form, contact-save, and format-data-record services plus the contact-photo and contacts-content components, with enketo-xml fixtures covering binary, orphan file, cleared file field, and file-in-repeat cases.

## Related Issues

- #10700: Support and route file attachments per child document (db-doc) in Enketo form submissions

## Domain Rationale

**Fit:** strong

The core change is in the Enketo form-submission pipeline (enketo.service, enketo-translation.service, form.service) governing how file-upload fields are translated into document attachments; the contacts touchpoints (photos, sub-contacts) are downstream consumers of this form mechanism, not the locus of the change.

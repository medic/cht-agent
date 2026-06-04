---
id: cht-core-10509
category: feature
domain: forms-and-reports
subDomain: enketo
issueNumber: 10509
issueUrl: https://github.com/medic/cht-core/issues/10509
title: Support uploading attachments in contact forms
lastUpdated: 2026-02-20
summary: Extended contact form submission to save file attachments (images, documents) to the contact document, matching the existing behavior in app forms where attachments are stored on the report document.
services:
  - webapp
techStack:
  - typescript
  - angular
---

## Problem

App forms supported file uploads (images, audio, video) which were saved as attachments on the resulting report document. Contact forms accepted the same upload questions but silently discarded the selected files on submission. The files were never stored as attachments on the contact document.

## Root Cause

The contact form submission code path in `contact-save.service.ts` did not process file upload fields. It extracted scalar form values but skipped binary attachment data. The app form submission path had this logic, but it was not shared with the contact form path.

## Solution

Updated the contact save flow to extract file attachments from the Enketo form and store them as CouchDB attachments on the contact document. PR #10570 modified 9 files across the webapp services and tests.

## Code Patterns

- File attachments from Enketo forms are stored as CouchDB document attachments, not as separate documents
- The attachment extraction logic should be shared between app form and contact form submission paths to avoid divergence
- File: `webapp/src/ts/services/contact-save.service.ts` handles contact form submission
- File: `webapp/src/ts/services/enketo.service.ts` extracts attachments from the form DOM
- Pattern: when adding features to contact forms, check whether the equivalent already exists for app forms and reuse the implementation

## Design Choices

- Stored attachments directly on the contact document rather than creating linked report documents, since the files are properties of the contact (e.g. profile photo) not reports about the contact
- Reused the existing attachment extraction logic from the enketo service rather than duplicating it

## Related Files

- webapp/src/ts/services/contact-save.service.ts
- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/src/ts/services/form.service.ts

## Testing

- Unit tests for attachment extraction during contact save
- E2E tests uploading a file in a contact form and verifying it is stored on the contact document

## Related Issues

- #9601: Prevent duplicate sibling contact capture (other recent contact form work)

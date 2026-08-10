---
id: cht-core-10509
category: feature
domain: forms-and-reports
subDomain: enketo
issueNumber: 10509
issueUrl: https://github.com/medic/cht-core/issues/10509
title: Support uploading attachments in contact forms
lastUpdated: 2026-08-09
summary: Extended contact form submission to save file attachments (images, documents) to the contact document, matching the existing behavior in app forms where attachments are stored on the report document.
services:
  - webapp
techStack:
  - typescript
  - angular
source_prs:
  - "medic/cht-core#10570"
---

## Problem

App forms supported file uploads (images, audio, video) which were saved as attachments on the resulting report document. Contact forms accepted the same upload questions but silently discarded the selected files on submission. The files were never stored as attachments on the contact document.

## Root Cause

The contact form submission code path in `contact-save.service.ts` did not process file upload fields. It extracted scalar form values but skipped binary attachment data. The app form submission path had this logic in `enketo.service.ts`, but inline inside `xmlToDocs` rather than in any callable helper, so the contact form path had nothing to reuse.

## Solution

Updated the contact save flow to extract file attachments from the Enketo form and store them as CouchDB attachments on the contact document. PR #10570 changed 9 files: 4 modified in the webapp (`contact-save.service.ts`, `contacts-edit.component.ts` and their two Karma specs) and 5 added under `tests/` (a wdio e2e spec plus two contact forms, and a cht-form integration spec plus its form).

`contact-save.service.ts` gained a private `processAllAttachments()` that runs over the prepared docs and attaches to the *main* doc only: files from `FileManager.getCurrentFiles()` are stored as `user-file-<sanitized name>` via `AttachmentService.add`, and `[type=binary]` XML fields are named from their `Xpath.getElementXPath()` path with the instance root swapped for the form id. Supporting helpers cover filename sanitization (falling back to a UUID stem when a non-Latin name sanitizes to nothing), rewriting field values to match sanitized attachment names, and pruning orphaned `user-file-` attachments on edit. `contacts-edit.component.ts` separately gained `renderAttachmentPreviews()` so existing image attachments show up when re-editing a contact.

Note that this PR did **not** touch `enketo.service.ts`: the extraction logic was re-implemented in the contact path rather than shared.

## Code Patterns

- File attachments from Enketo forms are stored as CouchDB document attachments on the main doc, not as separate documents, under a `user-file-` name prefix
- Two sources feed one extraction pass: `FileManager.getCurrentFiles()` for file-widget uploads, and `[type=binary]` elements in the submitted XML for inline binary fields (named from their XPath)
- Sanitize upload filenames before they become attachment names, and rewrite the matching field values in the doc so the two stay in sync; prune `user-file-` attachments no longer referenced, or edits accumulate orphans
- The attachment extraction logic *should* be shared between the app form and contact form submission paths — this PR did not do that, and the resulting duplication between `enketo.service.ts` and `contact-save.service.ts` did not survive long: #11256 deleted `contact-save.service.ts` and folded the contact save path into `enketo.service.ts`
- File: `webapp/src/ts/services/contact-save.service.ts` handled contact form submission as of this PR; it was deleted on 2026-07-29 by #11256, which folded the contact save path into `enketo.service.ts`
- File: `webapp/src/ts/services/enketo.service.ts` held the app-form attachment extraction at the time of this PR, but inline inside `xmlToDocs` — `FileManager.getCurrentFiles().forEach(file => this.attachmentService.add(doc, `user-file-${file.name}`, …))` plus an inline `'user-file' + …` name for binary elements. There was no callable helper to reuse, which is why the contact path re-implemented it. (The extracted `processFormAttachments` / `buildBinaryAttachmentData` methods a reader will find there today were added later, by the #11256 form-save rewrite.)

## Design Choices

- Stored attachments directly on the contact document rather than creating linked report documents, since the files are properties of the contact (e.g. profile photo) not reports about the contact
- Attached only to the main document and not to repeats or sibling sub-docs, matching the issue's explicit "out of scope" list
- Re-implemented the extraction inside `contact-save.service.ts` instead of reusing the enketo service's version, because there was nothing there to call: the equivalent logic was inline in `xmlToDocs`, not a helper. The duplication was the accepted cost of shipping; the two paths were later merged by the Enketo form-save rewrite (#11256)
- Limited edit-time previews to `image/*` file inputs, leaving other file types without a thumbnail

## Related Files

Changed by PR #10570:

- webapp/src/ts/services/contact-save.service.ts (deleted from master by #11256)
- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/tests/karma/ts/services/contact-save.service.spec.ts (deleted from master by #11256)
- webapp/tests/karma/ts/modules/contacts/contacts-edit.component.spec.ts
- tests/e2e/default/contacts/contact-attachments.wdio-spec.js
- tests/e2e/default/contacts/forms/person-with-attachments-create.xml
- tests/e2e/default/contacts/forms/person-with-attachments-edit.xml
- tests/integration/cht-form/default/contact-with-attachments.wdio-spec.js
- tests/integration/cht-form/default/forms/contact-with-attachments.xml

Referenced but not changed by this PR:

- webapp/src/ts/services/enketo.service.ts (the app-form path this feature mirrors)

## Testing

- Karma unit tests for attachment extraction during contact save (contact-save.service.spec.ts) and for the edit-time preview rendering (contacts-edit.component.spec.ts)
- A cht-form integration spec driving a contact form with attachments
- A wdio e2e spec uploading files in a contact form and verifying they land on the contact document — covering create with single and multiple attachments, and edit preserving existing ones

## Related Issues

- #9601: Prevent duplicate sibling contact capture (other recent contact form work)

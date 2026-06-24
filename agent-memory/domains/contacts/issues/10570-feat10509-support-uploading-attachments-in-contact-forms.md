---
id: cht-core-10509
category: feature
domain: contacts
domainFit: strong
issueNumber: 10509
issueUrl: https://github.com/medic/cht-core/issues/10509
title: Support uploading file and binary-field attachments in contact forms
lastUpdated: '2026-06-22'
summary: Contact forms could include ODK file-upload/media questions, but unlike app/report forms the selected files were never persisted on the contact document. This PR extracts file-widget and base64 binary-field attachments during contact save and attaches them to the main contact doc, preserving them on edit.
services:
  - webapp
techStack:
  - typescript
  - angular
  - couchdb
  - enketo
tags:
  - contact-forms
  - attachments
  - file-upload
  - binary-fields
  - enketo
  - filemanager
related_workflows:
  - contact-creation
  - form-submission
source_pr: medic/cht-core#10570
source_sha: d09d656cb8c1f560ea75c0819e3f58cb6db5778c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/contact-save.service.ts
  - webapp/src/ts/modules/contacts/contacts-edit.component.ts
concepts:
  - CouchDB document attachments
  - Enketo file widgets and FileManager extraction
  - base64 binary-field extraction from form XML
  - XPath-based attachment naming
  - attachment preservation via _defaults() merge on edit
  - parity with report-form attachment handling (EnketoService.xmlToDocs)
related_issues: []
stale: false
---

## Problem

Contact forms in CHT could include file/media upload questions, but the selected files were silently dropped on save rather than stored as attachments on the contact document — unlike app/report forms, which persist uploads as report-doc attachments. Users could not attach photos, signatures, or documents to contacts.

## Root Cause

ContactSaveService.prepareSubmittedDocsForSave() had no attachment-extraction step. Only the report-form path (EnketoService.xmlToDocs()) extracted FileManager files and base64 binary fields and persisted them as attachments; the contact save pipeline never invoked equivalent logic.

## Solution

Added a processAllAttachments() step (~30 lines) in ContactSaveService.prepareSubmittedDocsForSave() that pulls files out of FileManager (named `user-file-{filename}`) and base64 binary fields out of the submitted XML (named `user-file/{form-id}/{xpath}` via the Xpath utility), attaching all of them to the main contact document through AttachmentService — mirroring report-form behavior. The contacts-edit flow preserves existing attachments via the _defaults() merge when re-saving.

## Code Patterns

Reuse AttachmentService + FileManager + Xpath utility to attach uploads; naming conventions `user-file-{filename}` for Enketo file widgets and `user-file/{form-id}/{xpath}` for binary fields; mirror EnketoService.xmlToDocs() report-form logic inside ContactSaveService.prepareSubmittedDocsForSave(); attach everything to the main doc regardless of nested form structure.

## Design Choices

Per #10509 discussion and @jkuester's guidance, the implementation was deliberately simplified to match report-form behavior: all attachments attach to the main contact document only, regardless of form structure, rather than distributing them across child/nested docs. This kept the diff small (~30 lines), reused existing services, and stayed consistent with established report patterns instead of introducing a new attachment-routing service.

## Related Files

- webapp/src/ts/services/contact-save.service.ts
- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/tests/karma/ts/services/contact-save.service.spec.ts
- webapp/tests/karma/ts/modules/contacts/contacts-edit.component.spec.ts
- tests/e2e/default/contacts/contact-attachments.wdio-spec.js
- tests/e2e/default/contacts/forms/person-with-attachments-create.xml
- tests/e2e/default/contacts/forms/person-with-attachments-edit.xml
- tests/integration/cht-form/default/contact-with-attachments.wdio-spec.js
- tests/integration/cht-form/default/forms/contact-with-attachments.xml

## Testing

Added 8 Karma unit tests (contact-save.service.spec.ts) covering file-widget extraction, binary-field extraction with XPath naming, and mixed/multiple attachments all attaching to the main doc; 2 cht-form integration tests; and 5 WebdriverIO e2e tests (contact-attachments.wdio-spec.js) covering create with a single image, create with multiple attachments (image + document), and edit preserving existing attachments, plus new XML test forms. Manual testing verified CouchDB attachment naming and edit-form display. Reviewer (dianabarsan) flagged a bug during review that likely also affects report uploads.

## Related Issues

- #10509: feature request — contact forms should store uploaded files as attachments on the contact doc, the way app/report forms already do

## Domain Rationale

**Fit:** strong

All application code changes live in contact-specific modules (contact-save.service.ts, contacts-edit.component.ts) and the feature gives contact documents attachment support; it borders forms-and-reports because the mechanism mirrors report-form attachment handling, but the capability and code are squarely in the contacts domain.

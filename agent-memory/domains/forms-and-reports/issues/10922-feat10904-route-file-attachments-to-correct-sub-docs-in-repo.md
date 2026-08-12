---
id: cht-core-10904
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10904
issueUrl: https://github.com/medic/cht-core/issues/10904
title: Route file/binary attachments to the correct [db-doc="true"] sub-document in Enketo report forms
lastUpdated: '2026-08-12'
summary: Binary/file attachments in report forms were always saved to the main report doc, even when the field belonged to a `[db-doc="true"]` sub-document. This PR walks the XML tree to resolve each attachment's owning sub-doc and routes both FileManager uploads and inline base64 blobs accordingly. NOT ON MASTER — both PRs are merged, but into epic branches only, so none of this is shipped behaviour.
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
source_prs:
  - "medic/cht-core#10922"
  - "medic/cht-core#11116"
source_sha: cc34e086640dbfb67f9da42f5806d2701d77fea4
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/enketo.service.ts
  - resolveOwnerDoc
  - findFileNodeByFilename
concepts:
  - db-doc sub-document generation in Enketo forms
  - binary attachment routing
  - XML tree ancestor resolution
  - Enketo FileManager file handling
  - inline base64 binary blob extraction
  - epic-branch work not yet on master
related_issues:
  - cht-core-10700
  - cht-core-10903
stale: true
---

## Problem

> **Merged into epic branches on 2026-05-19 and 2026-05-29; not on `master` (as of 2026-08-12).** PR #10922 merged into `10700-photo-capture-in-sub-contacts-and-reports` (squash `cc34e08664`, which is the frontmatter `source_sha` and the current head of that branch) and PR #11116 merged into `5.1.2-FR-attachments-for-subcontacts` (squash `e88c88361`). Neither squash is an ancestor of `origin/master`, and neither `resolveOwnerDoc` nor `findFileNodeByFilename` exists in `webapp/src/ts/services/enketo.service.ts` on `master` — `git log -S` finds them in no commit reachable from it. Everything below describes the state of those branches, not shipped behaviour. (`cc34e08664` and `0df57c664` — the latter an interior commit of `origin/10700-photo-capture`, not a branch head — are two rebased copies of the same #10922 squash, identical under `git patch-id --stable`. The #11116 changes reach `5.1.2-FR-attachments-for-subcontacts` through its own squash rather than through either of those shas.)

When a report form contained `[db-doc="true"]` sub-documents with binary/file fields (e.g. photo capture for sub-contacts), every attachment was saved onto the main report doc regardless of which sub-doc the binary field actually belonged to, so sub-document photos/files landed on the wrong document.

## Root Cause

The Enketo service attached all binary/file fields (both FileManager uploads and inline base64 blobs) to the main report doc without inspecting the position of the binary node within the XML tree, so it never identified the nearest `[db-doc="true"]` ancestor that should own the attachment.

## Solution

On the epic branch, `resolveOwnerDoc()` walks up the XML tree from a binary node to the nearest `[db-doc="true"]` ancestor and returns the corresponding prepared sub-doc (falling back to the main report doc). `findFileNodeByFilename()` locates the `[type=file]` XML node whose text matches a FileManager filename so its tree position can be used — Enketo's `Nodeset.setVal` rewrites file-widget nodes from `type="binary"` to `type="file"` once a file has been uploaded, so `[type=file]` is the correct selector for FileManager entries; inline base64 blobs from draw/signature widgets keep `type="binary"` and are routed separately through `attachLegacyFile`. FileManager-uploaded files and inline base64 binary fields inside sub-docs are attached to the resolved owner doc instead of unconditionally to the main report.

The companion epic-level work (PR #11116) extended the same per-document routing into the enketo-translation layer (enketo-translation.service.ts) so file/binary fields are attached to their owning db-doc as the Enketo submission is translated into multiple CouchDB docs, and updated downstream contact rendering — contact-save.service.ts, format-data-record.service.ts and contacts-content.component.ts, plus a dedicated contact-photo component it adds — so contacts and sub-contacts display their correctly-routed photo attachment.

## Code Patterns

Ownership-by-tree-position (on the epic branches only — none of this is in `webapp/src/ts/services/enketo.service.ts` on `master`): `resolveOwnerDoc()` ascends XML parents to the nearest `[db-doc="true"]` node and maps it to its prepared sub-doc, with the main report doc as fallback. `findFileNodeByFilename()` bridges FileManager filenames back to their `[type=file]` XML node — the type Enketo rewrites file-widget nodes to after upload — so position-based routing works for uploaded files as well as for the inline `[type=binary]` blobs handled on the legacy path.

## Design Choices

Routing by XML node position (ancestor walk) rather than flat filename-to-doc matching is what lets an attachment reach its structurally-correct owner — subject to the starting-node caveat below, since the walk still begins from a node found by filename; falling back to the main report doc preserves backward-compatible behavior for forms without sub-docs. Each generated document is made self-contained with its own attachments, and the routing explicitly handles files within repeats plus cleared and orphaned file fields (PR #11116). Known limitation: the owner doc is decided by the ancestor walk, but the walk needs a starting node, and `findFileNodeByFilename()` finds that node by filename. When two sub-docs hold files of the same name (e.g. default-named camera captures) the lookup returns the first match, so both files start their walk from the same node and land on the same sub-doc.

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

Additional files touched by the epic-level PR #11116:

- webapp/src/ts/services/enketo-translation.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/contact-save.service.ts
- webapp/src/ts/services/format-data-record.service.ts
- webapp/src/ts/components/contact-photo/contact-photo.component.ts
- webapp/src/ts/components/contact-photo/contact-photo.component.html
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/ts/modules/contacts/contacts-content.component.html
- tests/e2e/default/contacts/sub-contact-attachments.wdio-spec.js

## Testing

Added Karma unit tests in enketo.service.spec.ts backed by new XML fixtures covering binary-in-sub-doc, file-field, cleared file field, orphan file (no db-doc ancestor → main report fallback), and db-doc-in-repeat-with-files. Added an end-to-end WDIO spec (submit-db-doc-file-upload.wdio-spec.js) with forms exercising multiple sub-docs, multi-file upload, and sub-docs inside repeats, asserting attachments are saved on the correct documents. PR #11116 added contact-attachments and sub-contact-attachments e2e specs plus family-with-attachments create/edit fixtures, and karma unit specs for enketo-translation, form, contact-save, and format-data-record services and the contact-photo and contacts-content components.

## Related Issues

- #10904: child issue this PR targets — route file attachments to correct sub-docs (still open; the PR merged into an epic branch, not into master)
- #10700: parent epic — photo capture for sub contacts
- #10903: sibling issue this work was adapted from

## Domain Rationale

**Fit:** strong

The change lives in the Enketo form-submission service (enketo.service.ts) on the epic branches and governs how report forms with `[db-doc="true"]` sub-documents produce docs and attach binary/file fields. Attachment routing during report-form processing is core forms-and-reports territory; the contact angle (sub-contact photo capture) is only the originating use case, not the mechanism.

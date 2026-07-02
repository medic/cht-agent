---
id: cht-core-8308
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 8308
issueUrl: https://github.com/medic/cht-core/issues/8308
title: Add support for the Enketo draw widget to capture free-hand drawings/signatures in forms
lastUpdated: '2026-06-23'
summary: CHT could not capture free-hand drawings or signatures in Enketo forms and forms with repeated file uploads failed to save. This PR enables and implements the Enketo draw widget and fixes the file manager's handling of repeated uploads.
services:
  - webapp
  - api
techStack:
  - typescript
  - javascript
  - angular
  - scss
  - enketo
  - webdriverio
tags:
  - enketo
  - draw-widget
  - signature
  - file-upload
  - widgets
  - form-attachments
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#8904
source_sha: 1afebb7970d5d92afcd4c709921410fbf741dfaf
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/draw.js
  - webapp/src/js/enketo/widgets.js
  - webapp/src/js/enketo/file-manager.js
  - webapp/src/js/enketo/lib/window.js
  - webapp/src/ts/services/enketo.service.ts
  - webapp/src/ts/services/format-data-record.service.ts
  - webapp/src/ts/modules/reports/reports-add.component.ts
  - webapp/src/css/enketo/draw.scss
concepts:
  - Enketo widget registration
  - form media/file attachments
  - free-hand drawing/signature capture
  - Enketo file manager extension
  - form submission attachment handling
related_issues: []
stale: false
---

## Problem

Two issues: (1) CHT could not collect signatures or free-hand drawings inside Enketo forms because the draw widget was not among the enabled widgets, despite an existing Enketo widget for it (#8308). (2) Submitting a form containing repeated file uploads triggered a TypeError ('Cannot read property...') so the report was not saved (#8072).

## Root Cause

(1) The Enketo draw widget was never registered/enabled in the webapp's widget list, so the input type was unavailable. (2) The Enketo file-manager / attachment-handling logic did not correctly cope with multiple files produced by repeat groups, dereferencing a missing property during submission.

## Solution

Implemented and registered the Enketo draw widget (webapp/src/js/enketo/widgets/draw.js, added to widgets.js) with supporting styling (draw.scss, _widgets.scss, medic.less). Extended the Enketo file manager to capture the widget's drawing output as an image attachment and fixed repeated-upload handling. Updated enketo.service.ts, format-data-record.service.ts, and reports-add.component.ts to persist/format the new attachments, and added widget translations across en/es/fr/ne/sw properties files.

## Code Patterns

Widget registration pattern in webapp/src/js/enketo/widgets.js plus a self-contained widget module under webapp/src/js/enketo/widgets/draw.js; extending the Enketo file manager (webapp/src/js/enketo/file-manager.js) to register additional file-producing widgets and normalize repeated uploads.

## Design Choices

Reused the existing Enketo signature/draw widget rather than building a bespoke drawing component. Per reviewer feedback, the integration test asserts the saved image size to confirm a substantial drawing was captured instead of doing brittle pixel-level comparisons, keeping tests focused and simple.

## Related Files

- webapp/src/js/enketo/widgets/draw.js
- webapp/src/js/enketo/widgets.js
- webapp/src/js/enketo/file-manager.js
- webapp/src/js/enketo/lib/window.js
- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/format-data-record.service.ts
- webapp/src/ts/modules/reports/reports-add.component.ts
- webapp/src/css/enketo/draw.scss
- webapp/src/css/enketo/_widgets.scss
- webapp/src/css/enketo/medic.less
- api/resources/translations/messages-en.properties
- webapp/package.json

## Testing

Added a cht-form integration test (tests/integration/cht-form/default/draw-widget.wdio-spec.js) with new form fixtures (draw-widget.xlsx/.xml), updated the file-upload integration test and fixtures, and updated the photo-upload e2e spec plus enketo page objects. Added/updated Karma and Mocha unit tests for file-manager, enketo.service, format-data-record.service, form.service, reports-add.component, and the enketo window lib. Strategy: assert the saved image size to verify a drawing was captured rather than exact pixel content.

## Related Issues

- #8308: Need to capture signatures/free-hand drawings within Enketo forms via the draw widget
- #8072: Form with repeated file uploads fails to submit/save (TypeError, report not saved)

## Domain Rationale

**Fit:** strong

The PR adds a new Enketo form input widget (free-hand draw/signature) and fixes file-attachment handling during form submission — both squarely about how Enketo forms render inputs and save report attachments. The repeated-upload bug (#8072) is a form-submission code error in the file manager, not a sync/replication issue, so it stays in forms-and-reports.

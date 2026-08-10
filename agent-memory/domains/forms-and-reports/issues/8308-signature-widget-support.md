---
id: cht-core-8308
category: feature
domain: forms-and-reports
subDomain: enketo
issueNumber: 8308
issueUrl: https://github.com/medic/cht-core/issues/8308
title: Add support for Signature/Draw Widget in Enketo forms
lastUpdated: '2026-08-09'
summary: Enabled the Enketo draw widget for collecting signatures and sketches within CHT forms. Required enabling the widget, adding file management support, and updating styles.
services:
  - webapp
  - api
techStack:
  - javascript
  - typescript
  - angular
  - scss
  - enketo
source_prs:
  - "medic/cht-core#8904"
---

## Problem

Deployments needed to collect signatures within forms (e.g. consent forms, delivery confirmations) but the Enketo draw widget was not enabled in the CHT. The widget existed in Enketo Core but was not included in the CHT's widget list and had compatibility issues during earlier testing.

## Root Cause

The CHT maintains a curated list of enabled Enketo widgets in `webapp/src/js/enketo/widgets.js`. The draw/signature widget was not in this list. Additionally, the file manager needed updates to handle the image data produced by the draw widget, and the CSS required customization to work within the CHT's layout.

## Solution

Enabled the draw widget by adding it to the widgets list, updated the file manager to handle drawn image data (`fileManager.getObjectUrl`, which loads an image into the canvas and re-fetches a saved drawing's attachment when editing a report), added the required CSS styles, and extracted `window.location.href` behind a thin `lib/window.js` indirection so the file manager can derive the report id being edited (and so unit tests can stub it). PR #8904 was a substantial change across translations, styles, and tests. The same PR also fixed a repeated-upload bug (#8072): `enketo.service.ts`'s `xmlToDocs` located each uploaded file by re-querying the DOM for `input[type=file][name="<xpath>"]` and dereferencing `$input[0].files[0]`; inside repeats the xpath-derived name did not match a live input, so `$input[0]` was undefined and submission threw a TypeError. The lookup was replaced with `FileManager.getCurrentFiles()`, which enumerates the files Enketo already holds, and attachment naming moved to the `user-file-<filename>` scheme (PR #8904).

## Code Patterns

- Enketo widgets are enabled by adding them to the array in `webapp/src/js/enketo/widgets.js`
- Each widget may need: file manager support, CSS styles, translations, and a small wrapper module around ambient browser state so it can be stubbed in Karma
- File: `webapp/src/js/enketo/widgets.js` is the widget registry
- File: `webapp/src/js/enketo/file-manager.js` handles binary data from widgets
- File: `webapp/src/js/enketo/widgets/draw.js` is the draw widget adapter
- Pattern: when enabling a new Enketo widget, check its dependencies (file handling, CSS, translations, DOM APIs) and, where the widget needs ambient browser state, wrap it in a small module so it can be stubbed in tests

## Design Choices

- Used the upstream Enketo draw widget rather than building a custom signature component, to stay aligned with the ODK ecosystem and benefit from upstream maintenance
- Extracted `webapp/src/js/enketo/lib/window.js` (`getCurrentHref()`) as a testability seam over `window.location.href`, which `fileManager.getObjectUrl` uses to work out which report doc to pull a saved drawing's attachment from when re-opening a report for edit
- Added new cht-form integration specs for both the draw widget and file upload (`tests/integration/cht-form/default/{draw-widget,file-upload}.wdio-spec.js`) to verify the full pipeline from widget interaction to attachment storage; the pre-existing `submit-photo-upload-form` e2e spec was updated rather than replaced

## Related Files

- webapp/src/js/enketo/widgets.js
- webapp/src/js/enketo/widgets/draw.js
- webapp/src/js/enketo/file-manager.js
- webapp/src/js/enketo/lib/window.js
- webapp/src/css/enketo/draw.scss
- webapp/src/css/enketo/_widgets.scss
- webapp/src/css/enketo/medic.less
- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/format-data-record.service.ts
- webapp/src/ts/modules/reports/reports-add.component.ts
- api/resources/translations/messages-en.properties
- webapp/package.json

## Testing

- Unit tests for file manager handling draw widget output
- Integration tests for the draw widget rendering and submission (tests/integration/cht-form/default/draw-widget.wdio-spec.js with draw-widget.xlsx/.xml fixtures)
- E2E test for photo upload forms (updated)
- Form fixture files for draw widget testing
- Test strategy: the integration test asserts the saved image size to confirm a substantial drawing was captured, rather than doing brittle pixel-level comparisons (PR #8904)

## Related Issues

- #8072: Form with repeated file uploads fails to submit/save (TypeError, report not saved) — fixed in the same PR

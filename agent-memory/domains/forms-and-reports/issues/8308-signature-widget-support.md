---
id: cht-core-8308
category: feature
domain: forms-and-reports
subDomain: enketo
issueNumber: 8308
issueUrl: https://github.com/medic/cht-core/issues/8308
title: Add support for Signature/Draw Widget in Enketo forms
lastUpdated: 2024-06-14
summary: Enabled the Enketo draw widget for collecting signatures and sketches within CHT forms. Required enabling the widget, adding file management support, and updating styles.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - angular
---

## Problem

Deployments needed to collect signatures within forms (e.g. consent forms, delivery confirmations) but the Enketo draw widget was not enabled in the CHT. The widget existed in Enketo Core but was not included in the CHT's widget list and had compatibility issues during earlier testing.

## Root Cause

The CHT maintains a curated list of enabled Enketo widgets in `webapp/src/js/enketo/widgets.js`. The draw/signature widget was not in this list. Additionally, the file manager needed updates to handle the image data produced by the draw widget, and the CSS required customization to work within the CHT's layout.

## Solution

Enabled the draw widget by adding it to the widgets list, updated the file manager to handle drawn image data, added the required CSS styles, and added a window shim for the widget's DOM requirements. PR #8904 was a substantial change across 31 files including translations, styles, and tests.

## Code Patterns

- Enketo widgets are enabled by adding them to the array in `webapp/src/js/enketo/widgets.js`
- Each widget may need: file manager support, CSS styles, DOM shims, and translations
- File: `webapp/src/js/enketo/widgets.js` is the widget registry
- File: `webapp/src/js/enketo/file-manager.js` handles binary data from widgets
- File: `webapp/src/js/enketo/widgets/draw.js` is the draw widget adapter
- Pattern: when enabling a new Enketo widget, check its dependencies (file handling, CSS, translations, DOM APIs) and provide shims as needed

## Design Choices

- Used the upstream Enketo draw widget rather than building a custom signature component, to stay aligned with the ODK ecosystem and benefit from upstream maintenance
- Added a window shim (`webapp/src/js/enketo/lib/window.js`) for APIs the widget expects but the CHT's service worker context does not provide
- Added both draw and file-upload integration tests to verify the full pipeline from widget interaction to attachment storage

## Related Files

- webapp/src/js/enketo/widgets.js
- webapp/src/js/enketo/widgets/draw.js
- webapp/src/js/enketo/file-manager.js
- webapp/src/js/enketo/lib/window.js
- webapp/src/css/enketo/draw.scss
- webapp/src/css/enketo/_widgets.scss
- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/format-data-record.service.ts

## Testing

- Unit tests for file manager handling draw widget output
- Integration tests for the draw widget rendering and submission
- E2E test for photo upload forms (updated)
- Form fixture files for draw widget testing

## Related Issues

- None directly linked

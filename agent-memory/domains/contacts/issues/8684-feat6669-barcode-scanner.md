---
id: cht-core-6669
category: feature
domain: contacts
domainFit: strong
issueNumber: 6669
issueUrl: https://github.com/medic/cht-core/issues/6669
title: Add barcode scanner to search for contacts using the native Barcode Detection API
lastUpdated: '2026-08-12'
summary: Health workers had no way to look up contacts by scanning a barcode and had to type identifiers manually. This adds a permission-gated barcode scanner button to the search bar that opens the device camera, reads the barcode from the captured image via the browser's native Barcode Detection API, and triggers a contact search with the decoded value. Landed on the 4.4.1-FR-barcode release branch via medic/cht-core#8684 (2023-11-16), not on master; as of 2026-08-12 none of this barcode-scanner code exists on origin/master (the only `barcode` matches there are the vendored Enketo XSL handling of the ODK `barcode` question type) and issue medic/cht-core#6669 remains open.
services:
  - webapp
  - api
techStack:
  - typescript
  - angular
  - less
  - barcode-detection-api
tags:
  - barcode-scanner
  - contact-search
  - search-bar
  - camera
  - permissions
  - telemetry
  - feature-detection
  - progressive-enhancement
related_workflows:
  - observability
source_pr: medic/cht-core#8684
source_sha: 59a1dbd248251bb5cf063211d2177d797c2c4f14
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/components/search-bar/search-bar.component.ts
  - webapp/src/ts/components/search-bar/search-bar.component.html
  - webapp/src/ts/services/browser-detector.service.ts
  - webapp/src/ts/modules/contacts/contacts.component.html
concepts:
  - native Barcode Detection API integration
  - permission-gated feature flag (can_use_barcode_scanner)
  - browser/feature detection and progressive enhancement
  - native camera access via hidden file input
  - telemetry instrumentation
related_issues: []
stale: true
---

## Problem

There was no way to look up a contact by scanning a barcode; users had to read and manually type identifiers into the search field, which is slow and error-prone for health workers scanning patient ID cards/barcodes in the field.

## Root Cause

Feature gap rather than a bug — CHT had no barcode-based contact search, and prior barcode approaches would have required custom code in the CHT Android wrapper that wouldn't carry over to PWA/Android browsers.

## Solution

Added a barcode scanner icon to the search bar, shown only when the `can_use_barcode_scanner` permission is granted (DB Admin excluded) and the device/browser supports the API. A hidden file input (type=file) triggers the OS camera; the captured image is loaded and decoded with the browser's native Barcode Detection API, and the resulting code is written into the search input to trigger a search. Added `isDesktopUserAgent()` to the pre-existing `browser-detector.service.ts` (introduced by #7568) so desktops are excluded; browsers without the `BarcodeDetector` API — including Chrome/Webview < v90 — fall out via the `'BarcodeDetector' in window` and empty-supported-formats checks. Also added six `search_by_barcode:*` telemetry events, a 'Failed to read the barcode. Retry' snackbar, and translations across en/es/fr/id/ne/sw plus the permission in default/demo/standard/covid-19 app_settings.

## Code Patterns

Feature detection in `canShowBarcodeScanner()` (search-bar.component.ts) checks Barcode Detection API support before rendering the scanner, delegating only the desktop exclusion to `isDesktopUserAgent()` in webapp/src/ts/services/browser-detector.service.ts; hidden `<input type=file>` in search-bar.component.html to invoke the native OS camera without custom Android code; permission gating via `can_use_barcode_scanner`; consistent `search_by_barcode:<event>` telemetry naming (open, not_supported, scan, trigger_search, barcode_not_detected, failure).

## Design Choices

Chose the native Barcode Detection API plus a hidden file input over custom CHT Android native code so the feature works uniformly across CHT Android, PWA, and Android Chrome with better accessibility and no app-specific maintenance. Accepted OS-managed limitations: cannot restrict the camera-vs-gallery picker, cannot force or detect camera permission, and some browsers may not support all barcode formats (supported formats logged to console). Planned as the first of four PRs (search-by-barcode, then Enketo widget, autoselect on single result, and e2e coverage); only this first PR was merged, and only into the 4.4.1-FR-barcode release branch.

## Related Files

Paths as touched on the 4.4.1-FR-barcode branch at the #8684 anchor (2023-11-16). All 17 existed at that anchor. Sixteen still exist on master and none of them carries any barcode code there; the exception is `config/standard/app_settings.json`, which is gone — the whole standard config was removed by medic/cht-core#8762 (`3f7f6d6e3`, January 2024) and `config/standard/` on master now holds only a `readme.md` pointer.

- webapp/src/ts/components/search-bar/search-bar.component.ts
- webapp/src/ts/components/search-bar/search-bar.component.html
- webapp/src/ts/services/browser-detector.service.ts
- webapp/src/ts/modules/contacts/contacts.component.html
- webapp/src/css/inbox.less
- config/default/app_settings.json
- config/demo/app_settings.json
- config/standard/app_settings.json
- config/covid-19/app_settings.json
- api/resources/translations/messages-en.properties
- api/resources/translations/messages-es.properties
- api/resources/translations/messages-fr.properties
- api/resources/translations/messages-id.properties
- api/resources/translations/messages-ne.properties
- api/resources/translations/messages-sw.properties
- webapp/tests/karma/ts/components/search-bar/search-bar.component.spec.ts
- webapp/tests/karma/ts/services/browser-detector.service.spec.ts

## Testing

Updated the Karma unit spec for the search-bar component (search-bar.component.spec.ts — modified, not added) and extended the existing browser-detector spec (browser-detector.service.spec.ts), covering support detection and scan/search behavior. End-to-end automation coverage was left to a planned follow-up PR that never reached master.

## Related Issues

- #6669: Barcode scanning using device camera — still open; planned as 4 PRs (search-by-barcode, Enketo barcode-reading widget, autoselect when one result, and automation test coverage), of which only search-by-barcode merged, to the 4.4.1-FR-barcode branch

## Domain Rationale

**Fit:** strong

The PR adds barcode scanning to the search bar specifically to look up contacts (wired into contacts.component.html), making it contact lookup/search. The app_settings permission and translation changes only gate/label the feature, so this is not a configuration or authentication PR.

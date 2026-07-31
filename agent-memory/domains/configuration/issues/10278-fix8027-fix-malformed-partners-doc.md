---
id: cht-core-8027
category: bug
domain: configuration
domainFit: strong
issueNumber: 8027
issueUrl: https://github.com/medic/cht-core/issues/8027
title: Defensively handle malformed partners branding document missing its 'resources' property to prevent fatal crashes in Admin app and Webapp
lastUpdated: '2026-07-30'
summary: A malformed partners document (empty content {}) uploaded via the cht tool caused fatal TypeErrors in both the Admin app and Webapp because code assumed the resources property existed. The fix adds null checks and initializes an empty resources object so the UI stays functional and users can repair the document.
services:
  - admin
  - webapp
techStack:
  - javascript
  - typescript
  - angularjs
  - angular
  - couchdb
tags:
  - defensive-programming
  - null-check
  - branding
  - partners-doc
  - resource-icons
  - error-handling
  - graceful-degradation
  - about-page
related_workflows: []
source_pr: medic/cht-core#10278
source_sha: 9b26cbd0e20b6f3ba44aaa4fb6e90f91c2592aec
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/images-partners.js
  - admin/src/js/services/resource-icons.js
  - webapp/src/ts/services/resource-icons.service.ts
concepts:
  - defensive null-checking
  - graceful degradation
  - resource icon documents
  - CouchDB attachment resources
  - branding configuration
related_issues: []
stale: false
---

## Problem

When a malformed partners document with content {} was uploaded via the cht tool, both the Admin app and Webapp threw fatal TypeErrors that completely blocked functionality. Admin app: 'TypeError: Cannot set properties of undefined (setting partner-name)' when saving partners, and 'TypeError: Cannot convert undefined or null to object' when loading the partners page. Webapp: 'TypeError: Cannot convert undefined or null to object' when accessing the About page. Users could neither access nor fix the malformed document.

## Root Cause

The code assumed the partners document's resources property always existed — calling Object.keys(res.resources) in getDocResources and writing partner properties onto doc.resources without an existence check. A malformed document lacking the resources property therefore triggered TypeErrors on load, save, and About-page render.

## Solution

Added null checks and lazy initialization of an empty resources object when it is missing. In the Admin controller (images-partners.js) a single `doc.resources = doc.resources || {};` was added in the attachment path — inside `addAttachment`, on the doc re-fetched after `putAttachment`, immediately before `doc.resources[$scope.name] = file.name` — while the document-loading path was left unchanged (a second, redundant initialization was dropped during review); in both the Admin service (resource-icons.js) and the Webapp service (then `resource-icons.service.ts`), getDocResources returns an empty array when resources is absent. This keeps the UI usable so users can view and edit the partners list to correct the malformed document instead of crashing.

## Code Patterns

Guard before iterating object keys: have `getDocResources` return `[]` when the doc has no resources rather than calling `Object.keys` on undefined — spelled `Object.keys((res && res.resources) ? res.resources : {})` in admin/src/js/services/resource-icons.js and `Object.keys(res?.resources ?? {})` in the webapp service; and initialize `doc.resources = doc.resources || {}` before writing partner properties in the attachment path (admin/src/js/controllers/images-partners.js). The two spellings differ because the Admin build cannot parse optional chaining — see Design Choices.

Note on paths: at the time of this fix the webapp service was `webapp/src/ts/services/resource-icons.service.ts` (spec `webapp/tests/karma/ts/services/resource-icon.service.spec.ts`). Both were replaced by `custom-resource.service.ts` / `custom-resource.service.spec.ts` in medic/cht-core#11050 (commit `180c29ecf`), so neither path exists on current master; the Admin-side paths are unchanged.

## Design Choices

Chose graceful degradation over rejecting/validating the bad document: initializing an empty resources object keeps the UI functional so users can repair the document in-place. Per review feedback, redundant resource initialization was removed, tests were consolidated to cut duplication, and one-liner style was applied. A reviewer-suggested `res?.resources` one-liner was declined for the Admin service because its browserify build does not parse optional chaining (build error surfaced in review) — which is why the Admin service keeps the ES5 spelling while the Angular-CLI-built webapp service uses `res?.resources ?? {}`.

## Related Files

- admin/src/js/controllers/images-partners.js
- admin/src/js/services/resource-icons.js
- admin/tests/unit/controllers/images-partners.spec.js
- admin/tests/unit/services/resource-icon.spec.js
- webapp/src/ts/services/resource-icons.service.ts (since replaced by custom-resource.service.ts in #11050)
- webapp/tests/karma/ts/services/resource-icon.service.spec.ts (since replaced by custom-resource.service.spec.ts in #11050)

## Testing

Added comprehensive unit tests covering all malformed-document scenarios, including a new Admin controller test file (images-partners.spec.js), plus updates to the Admin service spec and the Webapp Karma service spec. Tests were consolidated to reduce duplication; the fix was also verified locally.

## Related Issues

- #8027: malformed partners document (content {}) causes fatal crashes blocking the Admin partners page/save and the Webapp About page

## Domain Rationale

**Fit:** strong

The PR fixes crash handling for the 'partners' branding document (partner logos/resource icons shown on the About page and managed via the Admin app's images-partners section). App branding and resource-document config are canonically the configuration domain.

---
id: cht-core-10598
category: bug
domain: configuration
domainFit: strong
issueNumber: 10598
issueUrl: https://github.com/medic/cht-core/issues/10598
title: Fix admin languages service DB request after doc_by_type stopped emitting translations
lastUpdated: '2026-07-27'
summary: The admin privacy-policies change page loaded no privacy policies because the languages service still queried the medic-client/doc_by_type view with a key shape the view no longer emitted; the query was replaced with an allDocs prefix scan, restoring policy loading.
services:
  - admin
techStack:
  - javascript
  - angularjs
  - couchdb
tags:
  - languages-service
  - privacy-policies
  - couchdb-view
  - doc_by_type
  - alldocs
  - admin-app
  - db-query
  - bugfix
related_workflows: []
source_pr: medic/cht-core#10604
source_sha: 06d2e3abe205b1c2c396ea7f72849b149a1c8077
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/services/languages.js
  - medic-client/doc_by_type (CouchDB view)
concepts:
  - CouchDB map-reduce views
  - AngularJS service layer
  - allDocs prefix range scan
  - view emit-shape change consumer cleanup
related_issues: []
stale: false
---

## Problem

The admin app's privacy-policies change page displayed no privacy policies (issue #10598). The languages service queried `medic-client/doc_by_type` with `key: [ 'translations', true ]` and read each row's emitted `value`, but the view had stopped emitting that key and value, so the query returned zero rows.

## Root Cause

PR medic/cht-core#10255 (commit `de02d8421`, "chore(#8157): remove use of translationdoc.enabled") removed the `translations` special case from `ddocs/medic-db/medic-client/views/doc_by_type/map.js`, deleting the block that emitted `[ 'translations', doc.enabled ]` with a `{ code, name }` value and leaving only `emit([ doc.type ])`. The view itself was neither renamed nor removed — it still exists on master with roughly fifteen consumers. That PR updated `admin/src/js/controllers/display-languages.js` and `admin/src/js/controllers/display-translations.js` but missed `admin/src/js/services/languages.js`, which kept querying the old key shape and silently returned nothing.

## Solution

Replaced the stale view query in `admin/src/js/services/languages.js` with a direct `allDocs` range scan over the translation-doc id prefix — `.allDocs({ start_key: 'messages-', end_key: 'messages-￰', include_docs: true })` — and projected `{ code, name }` off `row.doc` instead of relying on a view-emitted value. The `lodash/core` import became unused and was removed. A new unit spec asserts the `allDocs` arguments.

## Code Patterns

A view consumer can break without the view being renamed. When a view's map function stops emitting a key or value shape — not only when the view name changes — grep every consumer of the view name across api/webapp/admin/sentinel, because a stale reference fails silently rather than erroring. Where the documents share an id prefix (here `messages-`), an `allDocs` range scan is a simpler and more robust alternative to a view query.

## Design Choices

Rather than restoring the emitted key shape in `doc_by_type` — which #10255 deliberately removed — the service switched to an `allDocs` prefix scan: no view involvement, no ddoc change, and no dependence on the removed `enabled` field. Enabled-language filtering now lives in settings, so returning every `messages-*` doc is correct.

## Related Files

- admin/src/js/services/languages.js (modified)
- admin/tests/unit/services/languages.spec.js (added)

## Testing

Added `admin/tests/unit/services/languages.spec.js` — the service had no spec before this PR. It asserts the `allDocs` arguments, the `{ code, name }` projection, an empty-rows result, and propagation of a DB rejection.

## Related Issues

- #10598: Admin app privacy policies change page not loading any privacy policies

## Domain Rationale

**Fit:** strong

The admin languages service manages locales/translations and powers the privacy-policies admin page — both canonical configuration concerns — so configuration is the functional home. The change itself is a document-access correction (data-layer) that leans data-sync, but the service's purpose makes configuration the better fit.

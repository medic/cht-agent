---
id: cht-core-10598
category: bug
domain: configuration
domainFit: strong
issueNumber: 10598
issueUrl: https://github.com/medic/cht-core/issues/10598
title: Fix admin languages service DB request that referenced the obsolete docs_by_type view path
lastUpdated: '2026-06-22'
summary: The admin privacy-policies change page loaded no privacy policies because the languages service's DB request still queried the old docs_by_type view path; the request was updated to the current path, restoring policy loading.
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
  - docs_by_type
  - admin-app
  - db-query
  - bugfix
related_workflows:
  - data-migration
source_pr: medic/cht-core#10604
source_sha: 06d2e3abe205b1c2c396ea7f72849b149a1c8077
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/services/languages.js
  - docs_by_type (CouchDB view)
concepts:
  - CouchDB map-reduce views
  - AngularJS service layer
  - view/query path migration consumer cleanup
related_issues: []
stale: false
---

## Problem

The admin app's privacy-policies change page displayed no privacy policies (issue #10598). The languages service's database request still pointed at the old docs_by_type view path, which had been removed/renamed by a prior migration, so the query no longer returned the expected documents.

## Root Cause

An earlier migration changed the docs_by_type view/query path, but the languages service's DB request was missed during that update and continued to reference the obsolete path, causing the lookup that backs the privacy-policies page to fail.

## Solution

Updated the languages service DB request in admin/src/js/services/languages.js to use the current view/query path instead of the stale docs_by_type path, and updated the corresponding unit tests to assert the corrected query.

## Code Patterns

When renaming or migrating a CouchDB view, grep every consumer of the old view name (e.g. docs_by_type) across api/webapp/admin/sentinel to catch missed references like this one — a single stale reference silently breaks a feature page.

## Design Choices

Applied a minimal, targeted query-path correction that matches the already-migrated view path rather than reworking the service, keeping behavior identical and backwards compatible with existing data and configuration.

## Related Files

- admin/src/js/services/languages.js
- admin/tests/unit/services/languages.spec.js

## Testing

Updated unit tests in admin/tests/unit/services/languages.spec.js to assert the languages service issues its DB request against the corrected view path.

## Related Issues

- #10598: Admin app privacy policies change page not loading any privacy policies

## Domain Rationale

**Fit:** strong

The admin languages service manages locales/translations and powers the privacy-policies admin page — both canonical configuration concerns — so configuration is the functional home. The change itself is a CouchDB view-query path correction (data-layer), which a reviewer could re-bin to data-sync, but the service's purpose makes configuration the better fit.

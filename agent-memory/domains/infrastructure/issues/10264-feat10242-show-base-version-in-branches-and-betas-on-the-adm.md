---
id: cht-core-10242
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 10242
issueUrl: https://github.com/medic/cht-core/issues/10242
title: Show base version column for branches and betas on the admin upgrade page
lastUpdated: '2026-06-22'
summary: The admin upgrade page listed available branch and beta builds without showing which base (major) version each targeted, making 4.x vs 5.x builds hard to distinguish. This PR adds a 'Base version' column to both the betas and branches sections.
services:
  - admin
  - api
techStack:
  - angularjs
  - javascript
  - html
  - webdriverio
tags:
  - upgrade-page
  - admin
  - build-version
  - base-version
  - i18n
  - release-management
related_workflows: []
source_pr: medic/cht-core#10264
source_sha: 029b86e60feb1cd00f5d9b9c5e480653fb462c3a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/directives/release.js
  - admin/src/js/filters/build-version.js
  - admin/src/templates/release.html
  - admin/src/templates/upgrade.html
concepts:
  - admin upgrade page
  - build/base version computation
  - release branches and betas
  - AngularJS filters and directives
  - internationalization (i18n)
related_issues: []
stale: false
---

## Problem

On the admin upgrade page, the betas and branches sections showed build names but not the underlying base (major) version, so administrators could not easily tell which major version (e.g. 4.x vs 5.x) a given branch or beta build was based on, creating confusion when selecting an upgrade target.

## Root Cause

Missing feature: the release directive/templates and the build-version filter rendered build identifiers with no field or column surfacing the base/major version for branch and beta builds.

## Solution

Added a 'Base version' column to both the betas and branches sections of the upgrade page. The build-version.js filter was updated to derive/expose the base version, release.js and the release.html/upgrade.html templates were updated to render the new column, the 'Base version' label key was added across all supported locales (ar, bm, en, es, fr, hi, id, ne, sw), and the wdio page object was extended to reference the new column.

## Code Patterns

Extend the AngularJS `build-version` filter (admin/src/js/filters/build-version.js) to derive a base/major version from a build name, surface it as a new column in release.html/upgrade.html, add the matching i18n label key to every api/resources/translations/messages-*.properties locale file, and add a selector/getter for the new column in tests/page-objects/upgrade/upgrade.wdio.page.js.

## Design Choices

Issue #10242 floated creating a separate `builds_5` release database to split 4.x and 5.x builds; this PR instead took the lighter approach of surfacing a 'Base version' column, giving immediate visual disambiguation of major versions without backend/database changes. The new label was internationalized across all locales per the project's i18n requirement.

## Related Files

- admin/src/js/directives/release.js
- admin/src/js/filters/build-version.js
- admin/src/templates/release.html
- admin/src/templates/upgrade.html
- api/resources/translations/messages-en.properties
- tests/page-objects/upgrade/upgrade.wdio.page.js

## Testing

The wdio page object (tests/page-objects/upgrade/upgrade.wdio.page.js) was updated to support the new 'Base version' column, providing e2e coverage of the upgrade page. No dedicated unit test file is included in the changed set.

## Related Issues

- #10242: Separate 4.x from 5.x builds on the Admin Upgrade page (originally proposed a builds_5 release database)

## Domain Rationale

**Fit:** strong

The admin upgrade page is part of CHT's release/deploy/upgrade tooling (operational lifecycle), and the PR modifies the build-version filter and release templates — directly paralleling the 'fix build version computation for release branches → infrastructure' seed. The translation-file edits are incidental i18n for the new label, not a configuration change.

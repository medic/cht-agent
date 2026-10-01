---
id: cht-core-10242
category: feature
domain: infrastructure
domainFit: weak
issueNumber: 10242
issueUrl: https://github.com/medic/cht-core/issues/10242
title: Show base version column for branches and betas on the admin upgrade page
lastUpdated: '2026-10-01'
summary: The admin upgrade page showed the base (major) version of branch and beta builds only as a suffix on the build name, which was hidden for long branch names, making 4.x vs 5.x builds hard to distinguish. This PR moves it into a 'Base version' column in both the betas and branches sections.
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
  - base version display
  - release branches and betas
  - AngularJS filters and directives
  - internationalization (i18n)
related_issues: []
stale: false
---

## Problem

On the admin upgrade page, the betas and branches sections mix builds based on different major versions (e.g. 4.x and 5.x). Before this PR, the `buildVersion` filter (admin/src/js/filters/build-version.js) showed a build's base version only as a parenthesised "~" suffix after the build name, which the issue discussion notes was hidden when the branch name was too long, so administrators could not easily tell which major version a given branch or beta build was based on, creating confusion when selecting an upgrade target.

## Root Cause

Missing feature: the release directive and templates had no column for the base version; it surfaced only through the `buildVersion` filter's suffix on the build name.

## Solution

Added a 'Base version' column to both the betas and branches sections of the upgrade page. admin/src/templates/upgrade.html gained an `instance.upgrade.base_version` heading in both sections and passes `show-base-version="true"` to their release rows; admin/src/js/directives/release.js gained a `showBaseVersion` binding, and admin/src/templates/release.html renders `{{ release.base_version }}` in its own column when that binding is set. The `buildVersion` filter now returns `buildInfo.version` alone; because the filter is shared, release and feature-release rows no longer show the suffix either, and neither of those lists got the new column. Every supported locale file gained the 'Base version' label key (ar, bm, en, es, fr, hi, id, ne, sw), and tests/page-objects/upgrade/upgrade.wdio.page.js now matches a branch's install button with `span*=${utils.escapeBranchName(branch)}`, without the trailing parenthesis the old suffix required.

## Code Patterns

Show auxiliary build metadata in its own column instead of packing it into a label: an opt-in directive binding (`showBaseVersion` in admin/src/js/directives/release.js, set with `show-base-version="true"`) renders `{{ release.base_version }}` in admin/src/templates/release.html, while the `buildVersion` filter (admin/src/js/filters/build-version.js) returns only `buildInfo.version`. Add the matching i18n label key to every api/resources/translations/messages-*.properties locale file, and keep e2e page-object selectors in tests/page-objects/upgrade/upgrade.wdio.page.js in step with the label text.

## Design Choices

Issue #10242 first proposed a separate release database for 5.x builds, like the earlier split between 3.x and 4.x builds; the issue discussion settled on the lighter approach of surfacing a 'Base version' column instead, giving immediate visual disambiguation of major versions without backend/database changes or extra steps at each future major release.

## Related Files

- admin/src/js/directives/release.js
- admin/src/js/filters/build-version.js
- admin/src/templates/release.html
- admin/src/templates/upgrade.html
- api/resources/translations/messages-en.properties
- tests/page-objects/upgrade/upgrade.wdio.page.js

## Testing

The only test-side change is in the wdio page object tests/page-objects/upgrade/upgrade.wdio.page.js, whose install-button selector for branches no longer expects the old suffix after the branch name. No dedicated unit test file is included in the changed set.

## Related Issues

- #10242: "Display major version in admin upgrade UI so it's clear if its 4.x or 5.x (or X.x!)" — first proposed a separate 5.x release database; the discussion settled on a base-version column instead

## Domain Rationale

**Fit:** weak

The change is admin-app presentation only — a column in admin/src/templates/upgrade.html and admin/src/templates/release.html, a trimmed `buildVersion` filter and one translation key; it does not touch how builds are published, listed or installed. It sits on the upgrade page, adjacent to release/upgrade tooling, but with no dedicated UI domain, infrastructure is the least-bad home rather than a principled fit.

---
id: cht-core-10908
category: feature
domain: configuration
domainFit: strong
issueNumber: 10908
issueUrl: https://github.com/medic/cht-core/issues/10908
title: Support ordering header tabs and sidebar menu options by a configurable `weight` property (app settings + UI Extensions)
lastUpdated: '2026-06-22'
summary: Header tab order ('Messages', 'Reports', 'People', etc.) was fixed and non-configurable, blocking deployments from controlling tab order and the initial landing tab. This PR makes ordering driven by a configurable `weight` on header_tabs app settings and header_tab UI Extensions, honored in both the new and old UI, and refactors sidebar menu option handling to reuse the same pattern.
services:
  - webapp
techStack:
  - typescript
  - angular
  - karma
  - webdriverio
tags:
  - navigation
  - header-tabs
  - sidebar-menu
  - ui-extensions
  - ordering
  - weight
  - app-settings
  - refactor
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#11057
source_sha: 46c8f7c8e43a969d9ecd12c65d3816b19664fd63
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/header-tabs.service.ts
  - webapp/src/ts/services/ui-extensions.service.ts
  - webapp/src/ts/components/header/header.component.ts
  - webapp/src/ts/components/sidebar-menu/sidebar-menu.component.ts
concepts:
  - configuration-driven UI
  - weight-based ordering
  - header tabs navigation
  - UI Extensions
  - sidebar menu
  - new vs old UI parity
related_issues: []
stale: false
---

## Problem

The ordering of the main interface header tabs was hardcoded and non-configurable, so deployments could not control tab order or which tab a user initially lands on — a capability repeatedly requested on the forum and made more pressing by new custom UI Extension tabs. Additionally, sidebar menu option handling carried considerable duplication and complexity between the new and old UI.

## Root Cause

Tab order was fixed in the navigation rendering with no mechanism to read an ordering property from configuration, and sidebar menu options were implemented with duplicated logic across the new and old UI rather than a shared, ordered pattern.

## Solution

Added support for a numeric `weight` property — settable in the `header_tabs` app settings and on `header_tab` UI Extensions — that determines tab display order (and therefore the initial landing tab). Ordering is computed in header-tabs.service.ts and ui-extensions.service.ts and applied in both the new (header.component) and old UI. Sidebar menu option handling was refactored to follow the same weight/ordering pattern used for header tabs, eliminating the new-vs-old UI duplication.

## Code Patterns

Weight-based sort pattern: tabs/extensions carry a numeric `weight` and are sorted before rendering in header-tabs.service.ts and ui-extensions.service.ts. The same ordering abstraction is reused by sidebar-menu.component.ts instead of duplicating logic between the new and old UI; header.component and sidebar-menu consume the pre-ordered lists.

## Design Choices

Made ordering configuration-driven via `weight` so deployments can reorder tabs and set the landing tab without code changes. Honored the ordering in both the new (default) and old (can_view_old_navigation) UI for backwards compatibility. Refactored sidebar menu handling to reuse the header-tabs ordering pattern rather than maintaining parallel, duplicated implementations.

## Related Files

- webapp/src/ts/services/header-tabs.service.ts
- webapp/src/ts/services/ui-extensions.service.ts
- webapp/src/ts/components/header/header.component.ts
- webapp/src/ts/components/header/header.component.html
- webapp/src/ts/components/sidebar-menu/sidebar-menu.component.ts
- webapp/src/ts/components/sidebar-menu/sidebar-menu.component.html
- tests/e2e/default/navigation/navigation.wdio-spec.js
- tests/e2e/default/old-navigation/old-navigation.wdio-spec.js
- tests/page-objects/default/common/common.wdio.page.js

## Testing

Karma unit tests added/updated for header-tabs.service, ui-extensions.service, header.component, sidebar-menu.component, and app.component to cover weight-based ordering. WebdriverIO e2e specs updated for both new navigation and old navigation, with supporting changes to the common page object. Per the AI disclosure, most unit test updates were authored by Claude and reviewed by the PR author.

## Related Issues

- #10908: Make header tab ordering configurable so deployments control tab order and the initial landing tab (closed by this PR)
- #10672: Blocker for #10908 (UI Extensions groundwork)
- #10901: Blocker for #10908
- cht-docs#2213: Documentation for the new header_tabs/UI Extension weight configuration

## Domain Rationale

**Fit:** strong

The feature's purpose is to give deployments configuration control over navigation: a new `weight` property in the `header_tabs` app settings (and on `header_tab` UI Extensions) drives tab order and the initial landing tab. App-settings-driven behavior is canonically the configuration domain, even though the implementation lives in webapp UI components/services (there is no dedicated navigation/UI domain).

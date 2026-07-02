---
id: cht-core-10766
category: feature
domain: contacts
domainFit: strong
issueNumber: 10766
issueUrl: https://github.com/medic/cht-core/issues/10766
title: Support collapsing/expanding contact-summary cards on the contact detail view
lastUpdated: '2026-06-22'
summary: Contact-summary cards on the contact detail view were always fully expanded, forcing heavy scrolling for data-dense cards (stock monitoring, immunizations). This PR lets users collapse/expand cards by tapping the header and adds a `collapsed` config property to start cards collapsed.
services:
  - webapp
techStack:
  - typescript
  - angular
  - less
  - html
tags:
  - contact-summary
  - collapsible-cards
  - contact-detail-view
  - accessibility
  - aria-expanded
  - ui
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10777
source_sha: 8222a062a639ba3cbdca04d5d57967b7eee24d25
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
  - webapp/src/ts/modules/contacts/contacts-content.component.html
  - webapp/src/css/inbox.less
concepts:
  - contact-summary cards
  - collapsible UI with per-card state
  - config-driven UI defaults
  - ARIA accessibility (role/aria-expanded)
  - scoped CSS to avoid style leakage
related_issues: []
stale: false
---

## Problem

Contact-summary cards on the contact detail view were always rendered fully expanded. For data-heavy cards (e.g. stock monitoring, immunizations) this consumed a large amount of screen space, forcing users to scroll extensively to reach content displayed below the card.

## Root Cause

By design, the contact-summary card template unconditionally rendered the fields section with no toggle interaction and no config option to control initial visibility; there was no per-card collapsed state in the component.

## Solution

Added a click handler plus `aria-expanded`, `role="button"`, and a chevron-icon toggle to `.action-header` in contacts-content.component.html, and gated the fields div with `*ngIf="!card.collapsed"`. The component tracks per-card collapsed state, honors a `collapsed: true` config default, and resets state when the displayed contact changes. Collapsible flexbox styles were scoped to `.compact-card .action-header` in inbox.less so other action-headers (tasks, reports, children) are unaffected.

## Code Patterns

Per-card collapse toggle: bind visibility with `*ngIf="!card.collapsed"` and flip state on header click, while exposing `aria-expanded`/`role="button"` on the header for accessibility (contacts-content.component.html). Scope new collapsible styling narrowly (`.compact-card .action-header` in inbox.less) instead of targeting all `.action-header` elements to prevent regressions in unrelated headers.

## Design Choices

Styling was deliberately scoped to `.compact-card .action-header` rather than all action-headers to avoid altering tasks/reports/children section headers. Per review feedback, the header was styled to match the rest of the app rather than look like a generic button. Both an interactive tap-to-toggle and a `collapsed` config default were supported so app builders can ship cards collapsed by default.

## Related Files

- webapp/src/ts/modules/contacts/contacts-content.component.html
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/css/inbox.less
- webapp/tests/karma/ts/modules/contacts/contacts-content.component.spec.ts
- tests/e2e/default/contacts/contact-details.wdio-spec.js
- tests/e2e/default/contacts/config/contact-summary-config.js
- tests/page-objects/default/contacts/contacts.wdio.page.js

## Testing

Added Karma unit tests covering default expanded state, `collapsed: true` config support, click-toggle behavior, `aria-expanded` reflection, and state reset on contact change. Added a WebdriverIO E2E test validating open-by-default and collapse-on-tap behavior, with a new contact-summary-config.js fixture for test setup.

## Related Issues

- #10766: Feature request to let users collapse/expand contact-summary cards (and support a `collapsed` config property) to reduce scrolling on data-dense cards

## Domain Rationale

**Fit:** strong

The PR modifies the contact detail view's contact-summary cards — UI behavior, template, styling, and state handling all live in the contacts module (contacts-content.component) and contact-focused tests. The new `collapsed` config property is just a flag for these cards, so the work squarely belongs to contacts rather than configuration.

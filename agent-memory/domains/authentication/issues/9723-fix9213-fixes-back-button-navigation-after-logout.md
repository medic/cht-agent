---
id: cht-core-9723
category: bug
domain: authentication
domainFit: strong
issueNumber: 9723
issueUrl: https://github.com/medic/cht-core/issues/9723
title: Clear browser history on logout to prevent back-button navigation to authenticated admin pages
lastUpdated: '2026-06-22'
summary: After logging out of the AngularJS admin console, the browser back button could navigate the user back to previously authenticated pages. The fix cleans the browser history during logout so back navigation no longer returns to those pages.
services:
  - admin
techStack:
  - angularjs
  - javascript
tags:
  - logout
  - session
  - back-button
  - browser-history
  - navigation
  - spa
related_workflows: []
source_pr: medic/cht-core#9723
source_sha: 41c424646ac1c9dd5200eaf352a58631b5663637
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/services/session.js
concepts:
  - session management
  - logout flow
  - browser history manipulation
  - single-page-application navigation
  - post-logout access prevention
related_issues: []
stale: false
---

## Problem

After a user logged out of the admin app, pressing the browser back button navigated them back to authenticated admin pages, exposing content from the ended session. Standard interception events (beforeunload, popstate, etc.) did not prevent this navigation under AngularJS (Angular v1).

## Root Cause

AngularJS retained the prior authenticated routes in the browser history, and none of the attempted navigation-guard events (beforeunload, popstate) could block the back-button transition in Angular v1, so the back button re-rendered authenticated views after logout.

## Solution

Modified the admin session service's logout handling to clean/clear the browser history so the authenticated pages are no longer reachable via the back button. This worked reliably across Chrome and Firefox where event-based interception failed.

## Code Patterns

Browser history cleanup invoked from the logout path in admin/src/js/services/session.js, used as a fallback when SPA navigation-guard events (beforeunload/popstate) cannot block back navigation.

## Design Choices

The author first tried event-based interception (beforeunload, popstate, etc.) but none prevented back navigation in AngularJS; cleaning the history proved the most reliable approach in Chrome and Firefox. Acknowledged as imperfect but a significant improvement over the prior behavior.

## Related Files

- admin/src/js/services/session.js
- admin/tests/unit/services/session.spec.js

## Testing

Unit tests added/updated in admin/tests/unit/services/session.spec.js, plus manual verification of back-button behavior in Chrome and Firefox (test video attached to the PR).

## Related Issues

- #9213: back button navigation after logout returns user to authenticated pages

## Domain Rationale

**Fit:** strong

The change lives in the admin app's session service and hardens the logout flow so users cannot return to authenticated pages — session/logout handling is canonically the authentication domain.

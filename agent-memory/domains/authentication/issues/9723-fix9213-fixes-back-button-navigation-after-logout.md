---
id: cht-core-9213
category: bug
domain: authentication
domainFit: strong
issueNumber: 9213
issueUrl: https://github.com/medic/cht-core/issues/9213
title: Push a root history entry before redirecting to login so the back button after logout does not return to the admin page
lastUpdated: '2026-09-29'
summary: After logging out of the AngularJS admin app, the browser back button loaded the previously authenticated admin page. The fix makes the admin Session service's navigateToLogin() call history.pushState(null, null, '/') just before it navigates to the login page, so the history step immediately behind the login page is / rather than the admin page. It does not remove the earlier entries.
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

After a user logged out of the admin app, pressing the browser back button loaded the authenticated admin page again instead of redirecting to login, exposing content from the ended session (issue #9213, reported on 4.6.0 in Chrome).

## Root Cause

`navigateToLogin()` in admin/src/js/services/session.js removed the `userCtx` cookie and then set `$window.location.href` to `/${Location.dbName}/login?...`. That is an ordinary navigation, so the authenticated admin page stayed as the previous browser-history entry and Back returned to it.

## Solution

`navigateToLogin()` now calls `$window.history.pushState(null, null, '/')` immediately before the `$window.location.href` assignment. The inline comment calls this clearing the browser history, but it adds a same-document entry with URL `/` rather than removing anything. The step immediately behind the login page is therefore `/`, not the admin page URL (the `redirect` query parameter is read from `$window.location.href` before the push, so it still names the admin page). `logout()` (after `$http` `.delete('/_session')`) and `checkCurrentSession()` (on a 401 from `/_session`) both go through `navigateToLogin()`, so every redirect to login gets the extra entry.

## Code Patterns

Push a neutral history entry (`$window.history.pushState(null, null, '/')`) right before a full-page redirect to login, in the one function every logout path shares (`navigateToLogin()` in admin/src/js/services/session.js). It is used in place of SPA navigation-guard events (beforeunload/popstate), which the PR description reports could not block back navigation under AngularJS.

## Design Choices

The PR description reports that event-based interception (beforeunload, popstate, etc.) did not prevent the navigation in Angular v1, and that the history approach worked best in Chrome and Firefox. It calls the result not perfect but a significant improvement. The earlier admin entries remain in history.

## Related Files

- admin/src/js/services/session.js
- admin/tests/unit/services/session.spec.js

## Testing

Updated admin/tests/unit/services/session.spec.js. The `$window` mock gains a `history.pushState` stub. 'logs out', 'logs out if no user context' and 'logs out if remote userCtx inconsistent' assert it was called once with `(null, null, '/')`. The 401 case ('cookie gets deleted when session expires') gains no `pushState` assertion. 'does not log out if server not found' and 'does not log out if remote userCtx consistent' assert it was not called.

## Related Issues

- #9213: "Admin app allows navigating back after logout" — this draft's issue

## Domain Rationale

**Fit:** strong

The change lives in the admin app's session service and hardens the logout flow, so that the back step after logout no longer lands on the authenticated admin page. Session and logout handling is canonically the authentication domain.

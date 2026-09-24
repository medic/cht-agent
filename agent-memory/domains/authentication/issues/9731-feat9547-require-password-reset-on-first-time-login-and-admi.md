---
id: cht-core-9547
category: feature
domain: authentication
domainFit: strong
issueNumber: 9547
issueUrl: https://github.com/medic/cht-core/issues/9547
title: Require password reset on first-time login and after admin updates a user's password
lastUpdated: '2026-06-22'
summary: Admins create CHW accounts and share a single password, which then stays valid indefinitely with no forced rotation. This PR adds a password-reset flow that requires users to set a new password on first login (and after an admin resets their password), enabled by default with a permission to skip it.
services:
  - api
  - admin
  - webapp
techStack:
  - javascript
  - angularjs
  - couchdb
  - service-worker
  - html
  - css
tags:
  - password-reset
  - first-login
  - password-change-required
  - security
  - user-management
  - login-flow
  - permissions
  - internationalization
related_workflows:
  - user-registration
source_pr: medic/cht-core#9731
source_sha: 67b533070d124a274994ce5b3e8a772986a239d1
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
  - api/src/public/login/password-reset.js
  - api/src/templates/login/password-reset.html
  - shared-libs/user-management/src/users.js
  - admin/src/js/controllers/edit-user.js
  - api/src/services/cookie.js
concepts:
  - password-reset enforcement on login
  - first-time login flow
  - password_change_required user flag
  - permission-gated bypass (can_skip_password_change)
  - cookie/session management
  - service-worker caching of login assets
related_issues: []
stale: false
---

## Problem

System admins create accounts for CHWs and share the password with them out-of-band. There was no mechanism to force the user to change that shared password on first login, nor to force a change after an admin reset a user's password, so initial/admin-set credentials remained valid indefinitely — a security weakness for newly provisioned accounts.

## Root Cause

Not a bug but a missing capability: the user model and login flow had no notion of a required password change. User documents carried no password_change_required flag, the login controller never redirected to a reset page, and the admin edit-user flow set a new password without flagging the account for forced rotation.

## Solution

Introduced a password_change_required flag on user docs (managed via shared-libs/user-management) and a dedicated password-reset page (password-reset.html + password-reset.js) in the login flow. The login controller (api/src/controllers/login.js) and routing redirect users flagged for a change to the reset page before granting full access; the cookie service tracks this state. The admin app (edit-user.js / edit_user.html) sets password_change_required and shows a hint that the user will be prompted to reset when an admin updates a password. A can_skip_password_change permission (defined in app_settings.json, enabled-by-default behavior) lets configured roles bypass the prompt, and the API supports explicitly setting password_change_required: false for specific users. All new UI text was internationalized across supported languages (ar, en, es, fr, id, ne, sw), and service-worker generation was updated to cache the new login assets.

## Code Patterns

Login client logic is shared between the standard login and the new reset page via api/src/public/login/auth-utils.js, with password-reset.js reusing it. The password_change_required flag on the CouchDB _users doc acts as a server-side gate checked in api/src/controllers/login.js to drive the redirect, and a can_skip_password_change permission provides the role-based bypass — the standard CHT can_* permission pattern declared in config/*/app_settings.json.

## Design Choices

Enabled by default to satisfy the issue's security-first requirement, with a permission to skip rather than a global on/off toggle so behavior can be scoped per role. An API escape hatch (password_change_required: false for a specific user) covers exceptions. The admin app surfaces an explicit hint when changing a password so admins know the user will be prompted, rather than silently flagging the account.

## Related Files

- api/src/controllers/login.js
- api/src/public/login/password-reset.js
- api/src/templates/login/password-reset.html
- api/src/public/login/auth-utils.js
- api/src/public/login/script.js
- api/src/routing.js
- api/src/services/cookie.js
- api/src/generate-service-worker.js
- shared-libs/user-management/src/users.js
- admin/src/js/controllers/edit-user.js
- admin/src/templates/edit_user.html
- config/default/app_settings.json
- config/demo/app_settings.json
- webapp/src/js/bootstrapper/index.js
- api/resources/translations/messages-en.properties

## Testing

Unit tests added/updated for the login controller, cookie service, and service-worker generation (api/tests/mocha), the admin edit-user controller (admin/tests/unit), user-management users (shared-libs/user-management/test/unit), and the webapp bootstrapper (webapp/tests/mocha). Integration tests cover login and users (tests/integration/api/controllers). E2E (WebdriverIO) coverage updated for login/logout, service-worker, user/contact creation and replacement flows, plus the login page object and shared test utils.

## Related Issues

- #9547: Feature request to prompt a password change on first login to enhance security of admin-provisioned CHW accounts

## Domain Rationale

**Fit:** strong

The PR is entirely about the login/password lifecycle — enforcing a password reset on first login and after admin password changes, a new password-reset page, cookie/session handling, and a permission to bypass it — which is squarely authentication (seed #2 places login/session management in this domain).

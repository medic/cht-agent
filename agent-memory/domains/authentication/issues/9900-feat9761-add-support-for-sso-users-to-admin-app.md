---
id: cht-core-9761
category: feature
domain: authentication
domainFit: strong
issueNumber: 9761
issueUrl: https://github.com/medic/cht-core/issues/9761
title: Add support for creating/editing SSO (OIDC) users in the admin app via an oidc_provider toggle
lastUpdated: '2026-06-22'
summary: Admins had no way to designate a user as an SSO/OIDC user in the admin app. This adds a checkbox toggle that sets the user's oidc_provider property and disables password and token_login configuration, since SSO login is mutually exclusive with those methods.
services:
  - admin
  - api
techStack:
  - javascript
  - angularjs
  - oidc
  - couchdb
tags:
  - sso
  - oidc
  - user-management
  - admin-app
  - authentication
  - oidc_provider
  - token-login
related_workflows:
  - user-registration
source_pr: medic/cht-core#9900
source_sha: fd3bf4a4080037ab7b913dfc43260c74fddc0fc0
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/edit-user.js
  - admin/src/templates/edit_user.html
  - shared-libs/user-management/src/sso-login.js
  - shared-libs/user-management/src/token-login.js
  - shared-libs/user-management/src/users.js
concepts:
  - single sign-on (SSO)
  - OIDC identity provider
  - mutually-exclusive login methods
  - user authentication configuration
related_issues: []
stale: false
---

## Problem

The admin app's user create/edit flow supported only password and token-based login. There was no UI control to mark a user as an SSO (OIDC) user, no way to set the oidc_provider property, and no logic to prevent configuring a password or token_login for such users.

## Root Cause

This is a feature gap rather than a defect: the edit-user controller and template predated SSO support and offered no oidc_provider field, and the password/token_login inputs were not aware of an SSO mode that should disable them.

## Solution

Added a checkbox toggle in the edit-user template that flags the user as an SSO user; the edit-user controller sets oidc_provider and disables/clears the password and token_login configuration when the toggle is on (SSO being mutually exclusive with those methods). Added a user-facing translation string and corresponding unit, integration, and e2e coverage. Per review (jkuester), changes initially made to shared-libs/user-management were reconsidered against the SSO groundwork already landed in PR #9800, keeping the feature centered on the admin app.

## Code Patterns

Mutually-exclusive login-method handling: toggling SSO in admin/src/js/controllers/edit-user.js sets oidc_provider and gates the password/token_login fields; UI binding for the toggle lives in admin/src/templates/edit_user.html. SSO vs token-login resolution logic sits in shared-libs/user-management/src/{sso-login,token-login,users}.js.

## Design Choices

Implemented as a simple checkbox toggle (as specified in the issue) rather than a separate flow, with SSO treated as mutually exclusive with password and token_login so a user cannot have conflicting credentials. The change was deliberately scoped to the admin app, leaning on the SSO support already added to shared-libs/user-management in PR #9800 rather than duplicating it.

## Related Files

- admin/tests/unit/controllers/edit-user.spec.js
- api/resources/translations/messages-en.properties
- shared-libs/user-management/test/unit/sso-login.spec.js
- shared-libs/user-management/test/unit/token-login.spec.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js
- tests/e2e/default/users/add-user.wdio-spec.js
- tests/e2e/default/users/create-meta-db.wdio-spec.js
- tests/page-objects/default/users/user.wdio.page.js
- tests/e2e/default/contacts/delete-assigned-place.wdio-spec.js
- tests/e2e/default/contacts/person-under-area.wdio-spec.js
- tests/e2e/visual/contacts/contact-user-hierarchy-creation.wdio-spec.js

## Testing

Added unit tests for the admin edit-user controller (edit-user.spec.js) and for shared-libs/user-management (sso-login, token-login, users specs), integration tests for the users API controller, and updated e2e specs (add-user, create-meta-db, and several contacts specs) plus the users page object to exercise the new SSO toggle through the user create/edit flow.

## Related Issues

- #9761: Add support for SSO users — set oidc_provider, with a checkbox toggle that disables password/token_login configuration
- #9800: Prior PR that added SSO/OIDC groundwork to shared-libs/user-management, referenced during review to scope this PR to the admin app

## Domain Rationale

**Fit:** strong

The PR adds the ability to configure a user to authenticate via SSO (OIDC) — setting the oidc_provider property and making it mutually exclusive with password and token_login. Login method selection and identity-provider configuration are core authentication concerns, so this squarely belongs to authentication rather than configuration or contacts.

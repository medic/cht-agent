---
id: cht-core-8776
category: bug
domain: authentication
domainFit: strong
issueNumber: 8776
issueUrl: https://github.com/medic/cht-core/issues/8776
title: Block admin (CouchDB server admin) users from updating their own password via user settings, in both API and webapp
lastUpdated: '2026-06-23'
summary: Admin users could attempt to change their own password through the user-settings flow even though admin credentials live in CouchDB server config rather than the _users database, leading to broken/inconsistent behavior. The fix detects when the requesting user is an admin updating their own password and blocks it server-side, while hiding the password field in the webapp.
services:
  - api
  - webapp
techStack:
  - javascript
  - typescript
  - angular
  - nodejs
  - couchdb
tags:
  - password
  - admin-user
  - user-management
  - credentials
  - couchdb-admin
  - security
related_workflows:
  - user-registration
source_pr: medic/cht-core#8776
source_sha: 15f96b2a650e4edeb44defae31298473190287cf
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/users.js
  - shared-libs/user-management/src/users.js
  - shared-libs/settings/src/index.js
  - webapp/src/ts/modules/configuration-user/configuration-user.component.ts
  - webapp/src/ts/modules/configuration-user/configuration-user.component.html
concepts:
  - password management
  - CouchDB server admin vs _users-database user
  - user credential update flow
  - self-account privilege guard
  - user settings UI
related_issues: []
stale: false
---

## Problem

An admin user could try to update their own password through the user-settings interface, but CouchDB server admins have their credentials managed in CouchDB config rather than in the _users database, so the standard API password-update path did not apply to them and produced broken or confusing results.

## Root Cause

The user-update code path in the API controller and the user-management shared lib did not distinguish admin (CouchDB server admin) accounts from regular _users-database users when processing a password change, so an admin's self-password-update was accepted by a flow that only knows how to mutate _users docs.

## Solution

Added admin-detection (via shared-libs/settings) and a guard in shared-libs/user-management/src/users.js and api/src/controllers/users.js that rejects an admin updating their own password, and updated the webapp configuration-user component/template to hide or disable the password field (and/or surface an explanatory message) when the current user is an admin.

## Code Patterns

Settings helper to identify a CouchDB admin user (shared-libs/settings/src/index.js); guard clause in the user update flow that short-circuits/rejects an admin's self-password-update (shared-libs/user-management/src/users.js, api/src/controllers/users.js); conditional Angular template rendering of the password field based on admin status (configuration-user.component.ts/html).

## Design Choices

Block the operation rather than try to support admin password changes through the API, because admin credentials are managed at the CouchDB-config level outside the _users database; restriction is enforced server-side and mirrored in the UI to prevent user confusion.

## Related Files

- api/src/controllers/users.js
- shared-libs/settings/src/index.js
- shared-libs/settings/test/index.spec.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/users.spec.js
- webapp/src/ts/modules/configuration-user/configuration-user.component.ts
- webapp/src/ts/modules/configuration-user/configuration-user.component.html
- tests/e2e/upgrade/admin-user.wdio-spec.js
- tests/integration/api/controllers/users.spec.js
- tests/page-objects/default/common/common.wdio.page.js
- tests/page-objects/default/users/user-settings.wdio.page.js
- tests/utils/index.js

## Testing

Unit tests for the settings admin-detection helper (shared-libs/settings/test/index.spec.js) and the user-management guard (shared-libs/user-management/test/unit/users.spec.js); API integration tests (tests/integration/api/controllers/users.spec.js); and an e2e upgrade spec (tests/e2e/upgrade/admin-user.wdio-spec.js) with supporting page-object and test-util updates verifying the admin cannot change their own password in the UI.

## Related Issues

- #8096: block admins from updating own password

## Domain Rationale

**Fit:** strong

The PR governs password/credential management and distinguishes CouchDB admin accounts from regular users — credential handling and account-privilege checks are core authentication concerns, not the 'configuration-user' UI module they happen to live in.

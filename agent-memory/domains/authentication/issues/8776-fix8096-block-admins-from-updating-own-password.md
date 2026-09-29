---
id: cht-core-8096
category: bug
domain: authentication
domainFit: strong
issueNumber: 8096
issueUrl: https://github.com/medic/cht-core/issues/8096
title: Block password updates for CouchDB server-admin users in the users API and hide the webapp update-password link for admins
lastUpdated: '2026-09-29'
summary: Before this PR, changing a CouchDB server admin's password from the webapp's user settings rewrote the admin entry in CouchDB config (`updateAdminPassword`) but left the deployment's `COUCHDB_PASSWORD` environment variable on the old value, so the CHT instance stopped working and the UI showed a misleading incorrect-password error. The fix deletes that admin-password path, makes user-management reject any password update for a user listed in CouchDB's `admins` config with a 400 (`Admin passwords must be changed manually in the database`), and hides the webapp's update-password link for `_admin` users.
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
  - CouchDB-admin password-update guard
  - user settings UI
related_issues:
  - cht-core-6986
stale: false
---

## Problem

Changing the password of a CouchDB server admin (for example the `medic` user of a CHT Docker deployment) through the webapp's user settings was reported as a failure but had in fact been applied, and it broke the instance: CouchDB accepted the new password while the `COUCHDB_PASSWORD` environment variable the CHT containers are configured with still held the old one, so the services failed until an operator updated the variable and restarted the containers. The error the UI showed was "Password is not correct.", for a change CouchDB had already accepted.

## Root Cause

At this PR's parent, `saveUserUpdates()` in shared-libs/user-management/src/users.js (logic added for #6986 by PR #7410) saved the `_users` doc and then, when the update carried a password and `isDbAdmin(user)` found the name in CouchDB's `admins` config, called `couchSettings.updateAdminPassword()` (shared-libs/settings/src/index.js). That helper pbkdf2-hashed the password and PUT it to `_node/<node>/_config/admins/<name>` on every cluster node. Nothing could update the container environment's `COUCHDB_PASSWORD`, so the credentials the deployment runs on diverged from CouchDB's.

## Solution

Removed the admin-password path instead of repairing it: `updateAdminPassword`, `getPasswordHash` and `getCouchNodes` were deleted from shared-libs/settings/src/index.js, and `saveUserUpdates()` now throws `error400('Admin passwords must be changed manually in the database')` before writing anything when the update carries a password and `isDbAdmin(user)` is true. `saveUserUpdates()` backs both `updateUser()` and `resetPassword()`, so any password change or reset for a CouchDB-config admin through user-management is rejected with a 400, whoever requests it — not only an admin changing their own. In the webapp, `ConfigurationUserComponent` (webapp/src/ts/modules/configuration-user/configuration-user.component.ts) replaced its `user` field with `canUpdatePassword = !user.token_login && !this.sessionService.isAdmin()` (`SessionService.isAdmin()` checks for the `_admin` role), and webapp/src/ts/modules/configuration-user/configuration-user.component.html shows the update-password link only when `canUpdatePassword` is true. The api/src/controllers/users.js change only reformats an error message and a log line.

## Code Patterns

Validate before writing: the guard in `saveUserUpdates()` now runs before `db.users.put(user)`, so a rejected admin password change leaves the `_users` doc untouched (previously the doc was saved first and the CouchDB-config write followed). Admin status is read from CouchDB config on the server (`couchSettings` `.getCouchConfig('admins')` inside `isDbAdmin`) and from the `_admin` role in the webapp (`SessionService.isAdmin()`); the UI hides the link and the API still enforces the rule. On master `isDbAdmin` takes the username (`isDbAdmin(user.name)`, since PR #9731), and `canUpdatePassword` also excludes `user.oidc_login` (since PR #9955).

## Design Choices

Block the operation rather than keep writing admin passwords into CouchDB config: a deployment's admin credentials also live in the container environment (`COUCHDB_PASSWORD`), which CHT cannot update at runtime, so changing only CouchDB's copy bricks the install. The restriction is enforced server-side (a 400 from user-management) and mirrored in the webapp by hiding the update-password link. The PR discussion leaves the door open to re-enabling admin password changes if the container environment variable can one day be updated as well.

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

Removed the `updateAdminPassword` unit tests from shared-libs/settings/test/index.spec.js. In shared-libs/user-management/test/unit/users.spec.js the admin cases now expect the `Admin passwords must be changed manually in the database` error (`should throw when trying to update admin password - #8096`, `should throw for admin user`). The integration test that changed an admin's password through `/api/v1/users/<name>` and logged in with it was removed from tests/integration/api/controllers/users.spec.js, and the e2e upgrade spec (tests/e2e/upgrade/admin-user.wdio-spec.js) no longer changes the admin password before logging in. Page objects were adjusted: tests/page-objects/default/common/common.wdio.page.js dropped its wait for the update-password key icon and gained `openEditProfile()`, which tests/page-objects/default/users/user-settings.wdio.page.js now uses; tests/utils/index.js gained debug logging of responses.

## Related Issues

- #8096: "Admin password change breaks CHT, shows wrong error message" — the issue this PR closes
- #6986: "Changing admin password via webapp doesn't work" — the earlier bug whose fix (PR #7410) added the `updateAdminPassword` path this PR removes

## Domain Rationale

**Fit:** strong

The PR governs password/credential management and distinguishes CouchDB admin accounts from regular users — credential handling and account-privilege checks are core authentication concerns, not the 'configuration-user' UI module they happen to live in.

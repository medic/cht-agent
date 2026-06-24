---
id: cht-core-9890
category: feature
domain: authentication
domainFit: strong
issueNumber: 9890
issueUrl: https://github.com/medic/cht-core/issues/9890
title: Map OIDC/SSO identities to CHT users via oidc_username on _users doc and oidc_login flag on user-settings, hiding password update for SSO users
lastUpdated: '2026-06-22'
summary: OIDC users could not be reliably mapped to CHT users (CouchDB usernames can't contain '@' but SSO providers identify users by email), and SSO users were wrongly shown the in-app Update Password option. Replaced the boolean `oidc` field with an `oidc_username` string on the `_users` doc plus an `oidc_login` boolean on the replicated user-settings doc, mirroring the token-login pattern so the offline UI can hide password update for SSO users.
services:
  - api
  - webapp
techStack:
  - javascript
  - typescript
  - couchdb
  - angular
  - oidc
tags:
  - oidc
  - sso
  - single-sign-on
  - openid-connect
  - user-management
  - microsoft-entra-id
  - password-management
  - login
related_workflows:
  - user-registration
source_pr: medic/cht-core#9961
source_sha: 4b77459dee772ed4da0e08ba78ca21277922a091
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/sso-login.js
  - api/src/controllers/login.js
  - shared-libs/user-management/src/sso-login.js
  - shared-libs/user-management/src/users.js
  - shared-libs/user-management/src/token-login.js
  - ddocs/users-db/users/views/users_by_field/map.js
  - webapp/src/ts/modules/configuration-user/configuration-user.component.ts
  - webapp/src/ts/services/user-settings.service.ts
concepts:
  - OIDC/OpenID Connect identity federation
  - single sign-on (SSO)
  - separation of auth-sensitive data (_users doc) from non-sensitive data (user-settings doc)
  - CouchDB user document model and replication boundary
  - email-as-identity mapping for SSO providers
  - offline-aware UI gating via replicated user-settings flags
related_issues: []
stale: false
---

## Problem

CouchDB usernames have strict requirements (notably no '@'), but OIDC/SSO providers such as Microsoft Entra ID identify users by email via the id_token `email` claim, so there was no clean way to map an OIDC identity to a CHT user. The original design used only a boolean `oidc` flag on the `_users` doc, which could not store the mapping email and — because `_users` is not replicated to offline clients — gave the webapp no way to know a user was an SSO user. As a result, the in-app self-serve 'Update password' dialog was incorrectly shown to SSO users, who do not manage their password in CHT.

## Root Cause

OIDC state was modeled as a single boolean `oidc` field on the `_users` doc. That field could not hold the OIDC email/username used to map the provider identity to the CHT account, and since the `_users` database does not replicate to the offline webapp, the client UI had no signal to branch on for SSO users (e.g. to hide the password-update option). There was also no enforcement that OIDC users carry an email value to anchor the mapping.

## Solution

Replaced the boolean `oidc` field with a string `oidc_username` field on the `_users` doc (the auth-sensitive OIDC email/identifier used to map the provider identity to the CHT user) and added a boolean `oidc_login` field on the replicated `user-settings` doc. This mirrors the existing token-login pattern: sensitive auth data lives on `_users`, while a non-sensitive flag is mirrored onto `user-settings` so offline UI logic can react. The webapp reads `oidc_login` to hide the 'Update password' option for SSO users. The user-management library enforces that OIDC users must have an email, and the `users_by_field` view map was updated to index by the new field.

## Code Patterns

Dual-doc auth pattern: store auth-sensitive identity on the `_users` doc and mirror a non-sensitive boolean flag onto the replicated `user-settings` doc so offline clients can branch on it — implemented in shared-libs/user-management/src/sso-login.js mirroring shared-libs/user-management/src/token-login.js. UI gating by replicated user-settings flag: webapp/src/ts/modules/configuration-user/configuration-user.component.ts (via user-settings.service.ts) reads `oidc_login` to conditionally hide the update-password affordance.

## Design Choices

The data is deliberately split because the `_users` database is not replicated to offline clients: `oidc_username` (sensitive mapping key) stays on `_users`, while `oidc_login` (non-sensitive flag) goes on the replicated `user-settings` doc so the webapp can drive UI without exposing auth data. This reuses the established token-login convention rather than inventing a new mechanism. Email is used as the mapping key because CouchDB usernames cannot contain '@' while OIDC providers identify by email. Scope was kept to an MVP targeting Microsoft Entra ID.

## Related Files

- api/src/controllers/login.js
- api/src/services/settings.js
- api/src/services/sso-login.js
- api/tests/mocha/controllers/login.spec.js
- api/tests/mocha/services/sso-login.spec.js
- ddocs/users-db/users/views/users_by_field/map.js
- shared-libs/user-management/src/index.js
- shared-libs/user-management/src/sso-login.js
- shared-libs/user-management/src/token-login.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/sso-login.spec.js
- shared-libs/user-management/test/unit/token-login.spec.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/login.spec.js
- tests/integration/api/controllers/users.spec.js
- tests/utils/mock-oidc-provider.js
- webapp/src/ts/modules/configuration-user/configuration-user.component.ts
- webapp/src/ts/services/user-settings.service.ts
- webapp/tests/karma/karma-unit.base.conf.js
- webapp/tests/karma/ts/modules/configuration-user/configuration-user.component.spec.ts
- webapp/tests/karma/ts/services/update-password.service.spec.ts

## Testing

Extensive unit and integration coverage updated/added: api mocha specs (controllers/login.spec.js, services/sso-login.spec.js); shared-libs/user-management unit specs (sso-login, token-login, users); webapp karma specs for configuration-user.component and update-password.service; integration specs (api/controllers/login.spec.js, api/controllers/users.spec.js) backed by a mock OIDC provider util (tests/utils/mock-oidc-provider.js). PR checklist confirms UI/UX backwards compatibility (new and old navigation designs, RTL) and backwards compatibility with existing data/config.

## Related Issues

- #9890: Map OIDC users to CHT users using email since CouchDB usernames cannot contain '@'; MVP targeting Microsoft Entra ID.
- #9836: Hide the in-app self-serve 'Update password' dialog for SSO users.
- #9938: Require an email value for OIDC users so they can be mapped to the OIDC provider's id_token email claim.

## Domain Rationale

**Fit:** strong

The PR is entirely about OIDC/SSO login — mapping an external OIDC identity to a CHT user, storing auth-sensitive login data, and gating the in-app password-change affordance for SSO users. Identity federation and login/credential management are squarely the authentication domain.

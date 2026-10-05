---
id: cht-core-9735
category: feature
domain: authentication
domainFit: strong
issueNumber: 9735
issueUrl: https://github.com/medic/cht-core/issues/9735
title: Add OIDC single sign-on (SSO) authentication support
lastUpdated: '2026-10-05'
summary: 'Deployments wanting centralized single sign-on could not authenticate CHT users against an external OIDC/OAuth2 identity provider, since CHT only supported local password and token-login accounts. This PR adds end-to-end OIDC SSO: an oidc_username user property, an ''SSO Email Address'' field in the admin app, login/oidc/authorize and login/oidc endpoints that run the authorization-code flow and set a CouchDB AuthSession cookie, a ''Login with SSO'' button, and guards that keep SSO users out of password login, password reset, token login and the webapp''s update-password option.'
services:
  - api
  - admin
  - webapp
techStack:
  - javascript
  - nodejs
  - couchdb
  - openid-connect
  - oauth2
  - angularjs
tags:
  - oidc
  - sso
  - single-sign-on
  - authentication
  - login
  - oauth2
  - openid-connect
  - user-management
  - couchdb-session
related_workflows:
  - user-registration
source_pr: medic/cht-core#9955
source_sha: 2cbe9c10991de77e5ed7408432474800ea5185d4
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/openid-client.js
  - api/src/services/sso-login.js
  - api/src/controllers/login.js
  - api/src/controllers/users.js
  - shared-libs/user-management/src/sso-login.js
  - shared-libs/user-management/src/users.js
  - shared-libs/user-management/src/token-login.js
  - admin/src/js/controllers/edit-user.js
  - ddocs/users-db/users/views/users_by_field/map.js
  - webapp/src/ts/modules/configuration-user/configuration-user.component.ts
concepts:
  - OpenID Connect (OIDC) authentication
  - single sign-on (SSO)
  - OAuth2 authorization-code flow
  - back-channel token exchange (authorization_code -> id_token)
  - claim-based identity mapping (email claim -> oidc_username)
  - CouchDB session-cookie generation
  - external identity-provider integration
  - mutually-exclusive authentication methods
related_issues:
  - cht-core-9736
  - cht-core-9737
  - cht-core-9738
  - cht-core-9760
  - cht-core-9761
  - cht-core-9762
  - cht-core-9763
  - cht-core-9764
  - cht-core-9765
  - cht-core-9766
  - cht-core-9836
  - cht-core-9890
  - cht-core-9907
  - cht-core-9938
  - cht-core-9981
  - cht-core-9983
  - cht-core-10062
stale: true
---

## Problem

Some deployments use a centralized identity system and want users to authenticate through a single sign-on provider rather than maintaining a decentralized set of CHT-local accounts. CHT had no way to authenticate users against an external OIDC/OAuth2 identity provider — it only supported local passwords and token login, with no oidc_username property, no OIDC login endpoints, and no SSO affordances in the UI.

## Root Cause

Missing capability rather than a defect: the authentication flow (login controller, user-management library, and login page) only knew about local Couch credentials and token login. There was no OIDC client, no endpoints to drive the authorization-code flow, no way to associate a user with an external IdP identity, and no server configuration for an OIDC provider.

## Solution

Added full OIDC SSO support across the stack. (1) shared-libs/user-management adds an oidc_username user property on the /api/v?/users endpoints: it cannot be combined with password or token_login, auto-generates a random password, must be globally unique, and requires oidc_provider in app_settings. (2) The admin edit-user modal shows an 'SSO Email Address' field (`user.sso.username`; text input `id="sso-login"` in admin/src/templates/edit_user.html, bound to `oidc_username`) when oidc_provider is configured and token_login is off, hiding the token-login and password inputs when it is set. (3) New API endpoints /medic/login/oidc/authorize (handler `oidcAuthorize`; returns the IdP authorization URL as the body of a 302 response, which the login page's `requestSSOLogin` navigates to) and /medic/login/oidc (handler `oidcLogin`; completes the flow: exchanges the authorization_code for an id_token over a back-channel call with `openid-client`'s `authorizationCodeGrant`, matches the id_token email claim to exactly one user's oidc_username, and sets a CouchDB `AuthSession` cookie that the API computes itself). (4) A 'Login with SSO' button (`id="login-sso"` in api/src/templates/login/index.html) renders on the login page when oidc_provider is configured. (5) Password login, password reset and token login reject users whose `oidc_username` is set while oidc_provider is configured (`isOidcUser` in api/src/controllers/login.js; `getUserByToken` in shared-libs/user-management/src/token-login.js), and setting `oidc_username` mirrors a boolean `oidc_login` onto the user-settings doc, which the webapp's configuration-user component reads to hide the update-password option (`canUpdatePassword`). The users_by_field view is extended to index oidc_username for unique lookups; client_secret is read from the CHT credential `oidc:client-secret`, set via `PUT /api/v1/credentials/:key`.

## Code Patterns

New api/src/services/openid-client.js is a thin re-export of `openid-client`'s `discovery`, `buildAuthorizationUrl`, `authorizationCodeGrant` and `allowInsecureRequests`, so unit tests can stub the ESM dependency; api/src/services/sso-login.js uses it for discovery (`oidc_provider.discovery_url` and `client_id` from app_settings), the authorization URL (`getAuthorizationUrl`, scope `openid email`) and the code exchange (`getIdToken`). SSO session creation lives in api/src/services/sso-login.js: `getCookie` resolves the email claim to a single `_users` doc via `getUsersByOidcUsername` (shared-libs/user-management/src/sso-login.js) and `makeCookie` builds the `AuthSession` value itself — an HMAC-SHA1 over `<username>:<hex epoch seconds>` keyed by `couch_httpd_auth/secret` plus the user's `salt` — instead of posting credentials to `_session`. ddocs/users-db/users/views/users_by_field/map.js is extended to index oidc_username so the email claim can be resolved to a single user. Mutually-exclusive auth-method validation (oidc_username vs password vs token_login) lives in shared-libs/user-management/src/sso-login.js (`validateSsoLogin`, `validateSsoLoginUpdate`), called from `createUser`, `createUsers`, `createMultiFacilityUser` and `updateUser` in shared-libs/user-management/src/users.js.

## Design Choices

The id_token email claim is the join key against the oidc_username user property, so the IdP-asserted email determines the CHT user. OIDC users get an auto-generated random password (and `password_change_required: false`); the resulting `salt` on the `_users` doc is what `getCookie` needs to compute the session cookie (it rejects a user doc without one), while local login is refused by the explicit SSO-user guards on password login, password reset and token login. oidc_username must be unique and requires oidc_provider configured server-side to avoid ambiguous/misconfigured SSO. The post-login app locale comes from the id_token locale claim (when it names an enabled locale; otherwise the first enabled locale) rather than the login-page selection. client_secret is read from the credential store (`secureSettings.getCredentials(OIDC_CLIENT_SECRET_KEY)`, where `OIDC_CLIENT_SECRET_KEY = 'oidc:client-secret'`) rather than from app_settings, so the secret stays out of the `settings` doc, one of the `DEFAULT_DDOCS` every offline user replicates; credentials are stored encrypted in the vault database (`getVaultUrl` in shared-libs/settings/src/index.js). SSO is layered onto the existing CouchDB session-cookie model (issuing an `AuthSession` cookie) rather than replacing it, so all downstream authorization is unchanged.

## Related Files

- api/src/services/openid-client.js (added)
- api/src/services/sso-login.js (added)
- api/src/controllers/login.js
- api/src/controllers/users.js
- api/src/routing.js
- api/src/server-utils.js
- api/src/public/login/script.js
- api/src/templates/login/index.html
- shared-libs/user-management/src/sso-login.js (added)
- shared-libs/user-management/src/users.js
- shared-libs/user-management/src/token-login.js
- shared-libs/user-management/src/index.js
- admin/src/js/controllers/edit-user.js
- admin/src/templates/edit_user.html
- ddocs/users-db/users/views/users_by_field/map.js
- webapp/src/ts/modules/configuration-user/configuration-user.component.ts
- webapp/src/ts/services/user-settings.service.ts
- tests/utils/mock-oidc-provider.js (added)
- tests/e2e/default/login/sso-login.wdio-spec.js (added)

## Testing

New specs: api/tests/mocha/services/sso-login.spec.js, shared-libs/user-management/test/unit/sso-login.spec.js, the e2e spec tests/e2e/default/login/sso-login.wdio-spec.js, and webapp karma specs webapp/tests/karma/ts/modules/configuration-user/configuration-user.component.spec.ts and webapp/tests/karma/ts/services/update-password.service.spec.ts. Updated: mocha specs for the login and users controllers and server-utils; shared-libs/user-management token-login and users specs; admin/tests/unit/controllers/edit-user.spec.js; integration specs for the login and users controllers; the login and users page objects; and several user and contact e2e specs. The integration and e2e tests run against tests/utils/mock-oidc-provider.js (added), a local Express OIDC provider. The specs that use it set `allow_insecure_requests: true` in `oidc_provider` so the provider's plain-HTTP discovery is accepted.

## Related Issues

- #9735: "Single sign on (SSO) using identity provider" — the epic this PR closes (MVP scope); its sub-issues follow
- #9760: "Update `shared-libs/user-management` to accept an `oidc_provider` property for users" — the issue in this squash's commit subject; delivered by PR #9800 as a boolean `oidc` flag, replaced before landing by `oidc_username` (PR #9961)
- #9761: "Update user creation frontend to support creating SSO users" — the admin 'SSO Email Address' field (PR #9900)
- #9762: "Update CHT login page to have button for redirecting to OIDC provider" — the 'Login with SSO' button (PR #9877)
- #9763: "Update non-SSO login flow to not allow login if `oidc_provider` set for user" — password login and password reset reject SSO users (PR #9887)
- #9764: "Update `token_login` flow to not allow login if `oidc_provider` value is set for user." — token login rejects SSO users (PR #9901)
- #9765: "Add support to the CHT api for new endpoint for OIDC login" — the login/oidc/authorize and login/oidc endpoints (PR #9833)
- #9907: "Handle situation where CHT user does not exist for SSO user" — redirect back to the login page with `sso_error=ssouserinvalid` (PR #9833)
- #9890: "Ensure proper mapping for SSO users to Couch users" — the email claim to `oidc_username` mapping and the `oidc_login` user-settings flag (PR #9961)
- #9836: "Disable in-app password change functionality for SSO users" — the webapp hides the update-password option when `oidc_login` is set (PR #9961)
- #9938: "Require `email` to be provided for user when `oidc = true`" — closed by PR #9961; in the landed design `oidc_username` itself holds the email that the id_token email claim must match
- #9981: "SSO flow does not support ports with CHT instances not on 443" — fixed on `9735_sso` by commit `15f71f56a`; at this squash the OIDC redirect_uri is built from the configured `app_url` when set, falling back to the request host
- #9738: "Figure how to run e2e tests" — the SSO e2e spec tests/e2e/default/login/sso-login.wdio-spec.js (PR #9995)
- #9736: "Choose a Node OIDC library" — research sub-issue; this squash depends on `openid-client`
- #9737: "Select an Identity Provider service for development" — research sub-issue; no code of its own in this squash
- #9766: "Update cht-conf to support uploading the SSO config" — cht-conf tooling sub-issue; no code in this squash
- #10062: "Rendering issue in edit user modal for SSO user" — a later master fix (PR #10153) for a race in the admin edit-user modal, triggered by the extra `/api/v2/users/${$scope.model.name}` request this squash added to load `oidc_username` for users with `oidc_login` set
- #9983: "Require `app_url` to be set when enabling `token_login`" — a later master change (PR #10004): at this squash the OIDC handlers build their URLs from `serverUtils.getAppUrl(req)`, which falls back to the request host; PR #10004 replaced it with a module-local `getAppUrl()` in api/src/controllers/login.js that throws when `app_url` is unset

## Domain Rationale

**Fit:** strong

The PR implements OIDC single sign-on end to end — login endpoints, the OAuth2 authorization-code flow, and CouchDB session-cookie minting — which is core user authentication. The external identity-provider integration is a means of authenticating users (not health-data interoperability), so authentication is the squarely correct, strong-fit domain.

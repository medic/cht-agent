---
id: cht-core-9735
category: feature
domain: authentication
domainFit: strong
issueNumber: 9735
issueUrl: https://github.com/medic/cht-core/issues/9735
title: Add OIDC single sign-on (SSO) authentication support
lastUpdated: '2026-06-22'
summary: 'Deployments wanting centralized single sign-on could not authenticate CHT users against an external OIDC/OAuth2 identity provider, since CHT only supported local password and token-login accounts. This PR adds end-to-end OIDC SSO: an oidc_username user property, admin-app UI to manage SSO users, login endpoints that drive the OIDC flow and mint a Couch session, and a ''Login with SSO'' button.'
services:
  - api
  - admin
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
  - admin/src/js/controllers/edit-user.js
  - ddocs/users-db/users/views/users_by_field/map.js
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
  - cht-core-9760
  - cht-core-9761
  - cht-core-9762
  - cht-core-9763
  - cht-core-9764
  - cht-core-9765
  - cht-core-9890
  - cht-core-10062
stale: false
---

## Problem

Some deployments use a centralized identity system and want users to authenticate through a single sign-on provider rather than maintaining a decentralized set of CHT-local accounts. CHT had no way to authenticate users against an external OIDC/OAuth2 identity provider — it only supported local passwords and token login, with no oidc_username property, no OIDC login endpoints, and no SSO affordances in the UI.

## Root Cause

Missing capability rather than a defect: the authentication flow (login controller, user-management library, and login page) only knew about local Couch credentials and token login. There was no OIDC client, no endpoints to drive the authorization-code flow, no way to associate a user with an external IdP identity, and no server configuration for an OIDC provider.

## Solution

Added full OIDC SSO support across the stack. (1) shared-libs/user-management adds an oidc_username user property on the /api/v?/users endpoints: it cannot be combined with password or token_login, auto-generates a random password, must be globally unique, and requires oidc_provider in app_settings. (2) The admin edit-user modal shows an 'SSO Email Address' field when oidc_provider is configured and token_login is off, disabling password/token entry when set. (3) New API endpoints /medic/login/oidc/authorize (returns the IdP redirect URL) and /medic/login/oidc (completes the flow: exchanges the authorization_code for an id_token over a back-channel call via a new openid-client service, matches the id_token email claim to exactly one user's oidc_username, and mints a CouchDB _session cookie). (4) A 'Login with SSO' button renders on the login page when oidc_provider is configured. The users_by_field view is extended to index oidc_username for unique lookups; client_secret is stored via the /api/v1/credentials endpoint.

## Code Patterns

New api/src/services/openid-client.js wraps the openid-client library for OIDC discovery and token exchange. SSO session creation is encapsulated in api/src/services/sso-login.js and shared-libs/user-management/src/sso-login.js, which mimic the normal Couch _session login to produce a valid session cookie. ddocs/users-db/users/views/users_by_field/map.js is extended to index oidc_username so the email claim can be resolved to a single user. Mutually-exclusive auth-method validation (oidc_username vs password vs token_login) lives in shared-libs/user-management/src/users.js.

## Design Choices

The id_token email claim is the join key against the oidc_username user property, so the IdP-asserted email determines the CHT user. OIDC users get an auto-generated random password so they retain a valid Couch credential but cannot log in locally. oidc_username must be unique and requires oidc_provider configured server-side to avoid ambiguous/misconfigured SSO. The post-login app locale comes from the id_token locale claim rather than the login-page selection. client_secret is set through the credentials API instead of app_settings to keep the secret out of replicated settings. SSO is layered onto the existing CouchDB session-cookie model (minting a _session cookie) rather than replacing it, so all downstream authorization is unchanged.

## Related Files

- api/src/services/openid-client.js
- api/src/services/sso-login.js
- api/src/controllers/login.js
- api/src/controllers/users.js
- api/src/routing.js
- api/src/server-utils.js
- api/src/public/login/script.js
- api/src/templates/login/index.html
- shared-libs/user-management/src/sso-login.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/src/index.js
- admin/src/js/controllers/edit-user.js
- admin/src/templates/edit_user.html
- ddocs/users-db/users/views/users_by_field/map.js

## Testing

Added/updated mocha unit tests for the login controller, users controller, server-utils, and the api sso-login service; shared-libs/user-management unit tests for sso-login, token-login, and users; integration tests for the login and users controllers; and a new e2e wdio spec tests/e2e/default/login/sso-login.wdio-spec.js with supporting login/user page objects. The flow was additionally verified locally against Keycloak using allow_insecure_requests.

## Related Issues

- #9735: Parent feature request — support single sign-on via an OIDC/OAuth2 identity provider (MVP effort)
- #9760: Implementation ticket for OIDC user authentication (referenced in the PR title)

## Domain Rationale

**Fit:** strong

The PR implements OIDC single sign-on end to end — login endpoints, the OAuth2 authorization-code flow, and CouchDB session-cookie minting — which is core user authentication. The external identity-provider integration is a means of authenticating users (not health-data interoperability), so authentication is the squarely correct, strong-fit domain.

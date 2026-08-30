---
id: cht-core-9765
category: feature
domain: authentication
domainFit: strong
issueNumber: 9765
issueUrl: https://github.com/medic/cht-core/issues/9765
title: Add SSO login via OpenID Connect (OIDC) with authorization-code callback endpoint
lastUpdated: '2026-06-22'
summary: 'CHT only supported local username/password login and could not delegate authentication to external identity providers. This PR adds SSO via OIDC: a new callback endpoint exchanges the provider''s authorization_code for an id_token, maps the claims to a CHT user, and establishes a session — redirecting back to the login page with a helpful message when no matching CHT user exists.'
services:
  - api
techStack:
  - javascript
  - node.js
  - oidc
  - openid-connect
  - openid-client
  - express
  - couchdb
tags:
  - sso
  - oidc
  - openid-connect
  - single-sign-on
  - login
  - authentication
  - authorization-code-flow
  - id-token
related_workflows: []
source_pr: medic/cht-core#9833
source_sha: bd9b232437866773a935af2161b68831903c5323
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/openid-client.js
  - api/src/services/sso-login.js
  - api/src/controllers/login.js
  - api/src/routing.js
concepts:
  - OpenID Connect (OIDC)
  - single sign-on
  - authorization code flow
  - identity federation
  - id_token validation
  - session establishment
  - external identity provider integration
related_issues:
  - cht-core-9735
stale: false
---

## Problem

CHT authentication was limited to local username/password credentials. Organizations with an existing identity provider had no way to use single sign-on, and there was no mechanism to validate an external OIDC authorization_code or id_token. Additionally, when an SSO user authenticated successfully but no corresponding CHT user existed, there was no defined, user-friendly handling of that failure.

## Root Cause

Missing capability: the login controller and API had no route or service to delegate authentication to an external OIDC provider, exchange an authorization_code for an id_token, or reconcile the federated identity against an existing CHT user account.

## Solution

Added an OIDC SSO flow. A new openid-client.js service wraps the openid-client library to exchange the provider's authorization_code for a validated id_token. A new sso-login.js service maps the token claims to an existing CHT user and creates a session. A getOidc handler in login.js serves the GET /medic/login/oidc?code=... redirect-back endpoint (wired up in routing.js). When no matching CHT user is found, the user is redirected back to the login page with a localized helpful error message. Login UI (template, script, style) and translations across multiple languages (ar, bm, en, es, fr, hi, id, ne, sw) were updated for the SSO entry point and error messaging.

## Code Patterns

OIDC authorization-code callback pattern: provider redirects to GET /medic/login/oidc with a `code` query param → login.js getOidc → openid-client.js exchanges code for id_token → sso-login.js resolves the CHT user and establishes the session, redirecting to the login page with a localized message on failure. Integration testing pattern: tests/utils/mock-oidc-provider.js stands up a fake OIDC provider so the redirect/callback handshake can be exercised end-to-end.

## Design Choices

When SSO authentication succeeds but no CHT user is found, the flow redirects to the login page with a helpful, internationalized message rather than failing silently or auto-provisioning a user (resolving the #9907 discussion in favor of a safe, debuggable default). The standard `openid-client` library is used instead of hand-rolling the OIDC protocol.

## Related Files

- api/src/services/openid-client.js
- api/src/services/sso-login.js
- api/src/controllers/login.js
- api/src/routing.js
- api/src/templates/login/index.html
- api/src/public/login/script.js
- api/src/public/login/style.css
- api/tests/mocha/services/sso-login.spec.js
- api/tests/mocha/controllers/login.spec.js
- tests/integration/api/controllers/login.spec.js
- tests/utils/mock-oidc-provider.js

## Testing

Added unit tests for the new SSO service (api/tests/mocha/services/sso-login.spec.js) and the login controller (api/tests/mocha/controllers/login.spec.js), plus integration tests against the login controller (tests/integration/api/controllers/login.spec.js) backed by a new mock OIDC provider (tests/utils/mock-oidc-provider.js).

## Related Issues

- #9765: Add GET /medic/login/oidc endpoint that accepts the OIDC authorization_code, validates it via openid-client, and obtains an id_token
- #9907: When an SSO user authenticates but no matching CHT user exists, redirect back to the login page with a helpful message

## Domain Rationale

**Fit:** strong

The PR adds Single Sign-On login via OpenID Connect — authorization-code validation, id_token handling, and session establishment for federated identities — which is squarely core authentication functionality.

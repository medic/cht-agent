---
id: cht-core-9765
category: feature
domain: authentication
domainFit: strong
issueNumber: 9765
issueUrl: https://github.com/medic/cht-core/issues/9765
title: Add SSO login via OpenID Connect (OIDC) with authorization-code callback endpoint
lastUpdated: '2026-10-05'
summary: 'CHT only supported CHT-local credentials (username/password and token login) and could not delegate authentication to external identity providers. This PR adds the OIDC authorization-code flow to the API: `oidcAuthorize` (GET /medic/login/oidc/authorize) returns the provider''s authorization URL, and the callback `oidcLogin` (GET /medic/login/oidc) exchanges the authorization_code for an id_token, maps its `preferred_username` claim to a CHT user flagged `oidc` (replaced by the `email` claim and `oidc_username` before the epic reached master), computes a CouchDB AuthSession cookie and redirects into the app — or back to the login page with an `sso_error` message when no eligible CHT user exists.'
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
  - cht-core-9762
  - cht-core-9890
  - cht-core-9907
stale: true
---

> **Epic child.** PR #9833 was squash-merged into the feature branch `9735_sso`
> (`bd9b23243`, 2025-05-08), not into master. That branch reached master as PR #9955
> (`2cbe9c109`, 2025-06-03). Its own PR number is stamped nowhere on master, which is
> why this draft's `source_sha` does not resolve in a plain clone. Fetch it with
> `git fetch origin +refs/pull/9955/head:refs/verify/pr9955` — the epic PR's head ref.

> **Superseded before landing (`stale-as-written`):** at this PR, `getIdToken` returns the
> id_token `preferred_username` claim and `getCookie` looks that name up as the CHT username,
> requiring the `_users` doc's boolean `oidc` flag (`getUserSalt`); the cookie timestamp is
> now plus `couch_httpd_auth/timeout`; and `oidcLogin` hands the cookie to `setCookies`.
> Before `9735_sso` reached master, PR #9887 (`6716fb951`) made `oidcLogin` call
> `redirectToApp` directly, since `setCookies` rejects SSO users from that PR on; PR #9961
> (`4b77459de`) switched to the `email` claim matched against `oidc_username` through
> `getUsersByOidcUsername` (removing `getUserSalt`); commit `15f71f56a` built both URLs from
> `serverUtils.getAppUrl(req)`; and commit `81c934efa` made the cookie carry the current time.
> On master, `oidcLogin`, `oidcAuthorize`, both routes and api/src/services/openid-client.js
> keep their names; api/src/controllers/login.js builds the URLs with its own `getAppUrl()`, which requires
> `app_url` (PR #10004).

## Problem

CHT authentication was limited to CHT-local credentials (username/password, or token login). Organizations with an existing identity provider had no way to use single sign-on, and there was no mechanism to validate an external OIDC authorization_code or id_token. Additionally, when an SSO user authenticated successfully but no corresponding CHT user existed, there was no defined, user-friendly handling of that failure.

## Root Cause

Missing capability: the login controller and API had no route or service to delegate authentication to an external OIDC provider, exchange an authorization_code for an id_token, or reconcile the federated identity against an existing CHT user account.

## Solution

Added an OIDC SSO flow. A new api/src/services/openid-client.js re-exports `openid-client`'s `discovery`, `buildAuthorizationUrl`, `authorizationCodeGrant` and `allowInsecureRequests` so unit tests can stub the ESM dependency. A new api/src/services/sso-login.js loads the provider by discovery (`oidc_provider.discovery_url`, `client_id` and optional `allow_insecure_requests` from app_settings; client secret from the CHT credential `oidc:client-secret`), builds the authorization URL (`getAuthorizationUrl`, scope `openid email`), exchanges the code (`getIdToken`, calling `authorizationCodeGrant` with `idTokenExpected: true`), and computes the CouchDB `AuthSession` cookie for the matched user (`getCookie` and `makeCookie`: an HMAC-SHA1 keyed by `couch_httpd_auth/secret` plus the user's `salt`). Two handlers in api/src/controllers/login.js, routed in api/src/routing.js, drive it: `oidcAuthorize` (`GET /medic/login/oidc/authorize`) builds the redirect_uri `${req.protocol}://${req.get('host')}/${environment.db}/login/oidc` and returns the provider's authorization URL as the body of a 302 response, which the login page fetches through `requestSSOLogin` (in api/src/public/login/script.js) by XHR and assigns to `window.location`; `oidcLogin` (`GET /medic/login/oidc?code=...`, the redirect target) calls `getIdToken` and `getCookie`, then (at this PR) `setCookies`, and redirects into the app. Any error with `status` 401 from that chain redirects to the login page with the query `sso_error` set to `ssouserinvalid`, which the login page shows as the `login.sso.user_invalid` message; any other error sets it to `loginerror`. At this PR those 401s came from `getUserSalt` (no CHT user with that name, a user not flagged `oidc`, or no `salt`), from token-endpoint 401s that openid-client throws with their `status` (an OAuth error body such as `invalid_client`, or a `WWW-Authenticate` challenge) through `getIdToken` (`authServerCallRetry` rethrows any error with `status` below 500, so these reach `oidcLogin` unchanged; other provider failures, such as a non-200 discovery response, do not arrive with `status` 401 and surface as `loginerror`), and from `setCookies`, whose catch-all threw any failure after the cookie was computed (notably CouchDB rejecting the computed `AuthSession` cookie in `getUserCtxRetry`) as a 401 `Error getting authCtx`, so such failures also surfaced as `ssouserinvalid` rather than `loginerror`. The template api/src/templates/login/index.html moved the `id="login-sso"` button inside the form and added the `sso_user_invalid` error paragraph. api/src/public/login/style.css displays that paragraph in the `ssouserinvalid` state, and the `login.sso.user_invalid` key was added to all nine locale files (ar, bm, en, es, fr, hi, id, ne, sw), with text only in en and sw. `openid-client` (^6.4.2) was added to the root package.json dependencies, and the Node engine requirement moved from >=22.11.0 to >=22.15.0.

## Code Patterns

OIDC authorization-code pattern: the login page's `requestSSOLogin` calls GET /medic/login/oidc/authorize (`oidcAuthorize`) and navigates to the returned provider URL → the provider redirects to GET /medic/login/oidc with a `code` query param → api/src/controllers/login.js `oidcLogin` → api/src/services/sso-login.js `getIdToken` (openid-client `authorizationCodeGrant`, through the api/src/services/openid-client.js wrapper) → `getCookie` resolves the CHT user and builds the `AuthSession` cookie → `oidcLogin` sets the cookies and redirects into the app, or to the login page with `sso_error` on failure. Integration testing pattern: tests/utils/mock-oidc-provider.js stands up a local Express OIDC provider (a discovery document, `/connect/authorize`, and a `/connect/token` endpoint that returns a signed id_token and rejects a missing or `invalid` code) so integration tests can call `login/oidc/authorize` and `login/oidc?code=...` against it.

## Design Choices

When SSO authentication succeeds but no eligible CHT user is found, the flow redirects to the login page with the translatable `login.sso.user_invalid` message rather than failing silently or auto-provisioning a user (the behaviour #9907 asked for). The standard `openid-client` library handles the OIDC protocol, while the CouchDB session cookie is computed locally (`makeCookie`) instead of being obtained from `_session` with a password.

## Related Files

- api/src/services/openid-client.js (added)
- api/src/services/sso-login.js (added)
- api/src/controllers/login.js
- api/src/routing.js
- api/src/templates/login/index.html
- api/src/public/login/script.js
- api/src/public/login/style.css
- api/tests/mocha/services/sso-login.spec.js (added)
- api/tests/mocha/controllers/login.spec.js
- tests/integration/api/controllers/login.spec.js
- tests/utils/mock-oidc-provider.js (added)

## Testing

Added api/tests/mocha/services/sso-login.spec.js (`getAuthorizationUrl`, `getIdToken`, `getCookie`). The existing api/tests/mocha/controllers/login.spec.js gained `oidcLogin` and `oidcAuthorize` suites, and the existing tests/integration/api/controllers/login.spec.js gained an SSO suite (OIDC not configured, client secret missing, invalid discovery URL, CHT user missing, invalid codes, successful login) backed by the new mock OIDC provider (tests/utils/mock-oidc-provider.js).

## Related Issues

- #9765: "Add support to the CHT api for new endpoint for OIDC login" — the issue this PR implements; it described a single callback handler and an `oidc_provider` check on the `_users` doc, while the PR shipped `oidcLogin` plus `oidcAuthorize` and checks the `oidc` flag
- #9907: "Handle situation where CHT user does not exist for SSO user" — also closed by this PR: the `sso_error=ssouserinvalid` redirect and `login.sso.user_invalid` message
- #9735: "Single sign on (SSO) using identity provider" — the parent epic; this PR reached master inside PR #9955
- #9762: "Update CHT login page to have button for redirecting to OIDC provider" — the 'Login with SSO' button (PR #9877); this PR replaced its client-side `getSSOLoginUrl()` redirect with `requestSSOLogin()`
- #9890: "Ensure proper mapping for SSO users to Couch users" — replaced this PR's `preferred_username` and `oidc` lookup with the `email` claim and `oidc_username` (PR #9961)

## Domain Rationale

**Fit:** strong

The PR adds Single Sign-On login via OpenID Connect — authorization-code validation, id_token handling, and session establishment for federated identities — which is squarely core authentication functionality.
